/**
 * Core triage logic: calls a cheap model to decide if the bot should respond.
 *
 * The flow is simple:
 *   1. Build a prompt with the triage instructions + the message content
 *   2. Call the triage model via its provider's API
 *   3. Parse the response as RESPOND or SKIP
 *   4. Return true (should respond) or false (skip)
 */

import {
  DEFAULT_TRIAGE_MODEL,
  DEFAULT_TRIAGE_PROMPT,
  DEFAULT_MAX_TRIAGE_TOKENS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_CONFIDENCE_PROMPT,
  type TriageGateConfig,
} from "./config.js";
import { parseModelString, getProviderAdapter } from "./providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriageParams = {
  /** The message content to evaluate. */
  content: string;

  /** Sender identifier (when available). */
  senderName?: string;

  /** Plugin config. */
  config: TriageGateConfig;

  /**
   * Resolves an API key for a given provider/model.
   * Injected from the OpenClaw plugin runtime so the plugin stays model-agnostic.
   */
  resolveApiKey: (provider: string, model: string) => Promise<string>;

  /** Optional logger for debug output. */
  logger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
  };

  /** Recent messages from the group conversation for additional context. */
  recentMessages?: Array<{ role: string; content: string }>;
};

export type TriageResult = {
  /** Whether the bot should respond to this message. */
  shouldRespond: boolean;

  /** The raw response from the triage model (for debugging). */
  rawResponse: string;

  /** How long the triage call took in milliseconds. */
  durationMs: number;

  /** Confidence score 1-10 when useConfidenceScores is enabled. */
  confidenceScore?: number;
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Ask a cheap model whether the bot should respond to a group chat message.
 *
 * Returns `shouldRespond: true` if the model says RESPOND,
 * `shouldRespond: false` if it says SKIP.
 *
 * On error (API failure, timeout, etc.), defaults to `shouldRespond: true`
 * so the main model still runs — we'd rather waste some tokens than
 * silently drop messages.
 */
export async function evaluateMessage(params: TriageParams): Promise<TriageResult> {
  const { content, senderName, config, resolveApiKey, logger, recentMessages } = params;
  const startTime = Date.now();

  const modelString = config.triageModel ?? DEFAULT_TRIAGE_MODEL;
  const { provider, model } = parseModelString(modelString);
  const useConfidence = config.useConfidenceScores === true;
  const prompt = config.triagePrompt
    ?? (useConfidence ? DEFAULT_CONFIDENCE_PROMPT : DEFAULT_TRIAGE_PROMPT);
  const maxTokens = config.maxTriageTokens ?? DEFAULT_MAX_TRIAGE_TOKENS;

  try {
    // Resolve the API key from OpenClaw's provider config
    const apiKey = await resolveApiKey(provider, model);
    if (!apiKey) {
      logger?.warn?.(`triage-gate: no API key found for provider "${provider}", allowing message through`);
      return { shouldRespond: true, rawResponse: "", durationMs: Date.now() - startTime };
    }

    // Get the right adapter for this provider's API format
    const adapter = getProviderAdapter(provider);

    // Build the user message with available context
    const userMessage = buildTriageUserMessage({ content, senderName, recentMessages });

    // Make the API call
    const response = await fetch(adapter.endpoint, {
      method: "POST",
      headers: adapter.buildHeaders(apiKey),
      body: adapter.buildRequestBody({
        model,
        systemPrompt: prompt,
        userMessage,
        maxTokens,
      }),
      signal: AbortSignal.timeout(5000), // 5s timeout — triage should be fast
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      logger?.warn?.(
        `triage-gate: API returned ${response.status} from ${provider}, allowing message through. Error: ${errorText}`,
      );
      return { shouldRespond: true, rawResponse: errorText, durationMs: Date.now() - startTime };
    }

    const body = await response.json();
    const rawResponse = adapter.extractResponse(body);

    if (useConfidence) {
      const confidenceScore = parseConfidenceScore(rawResponse);
      const threshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
      const shouldRespond = confidenceScore >= threshold;
      return { shouldRespond, rawResponse, durationMs: Date.now() - startTime, confidenceScore };
    }

    const shouldRespond = parseTriageDecision(rawResponse);
    return { shouldRespond, rawResponse, durationMs: Date.now() - startTime };
  } catch (error) {
    // On any error, default to letting the message through.
    // Better to waste tokens than silently drop a message.
    logger?.warn?.(`triage-gate: error during triage (${String(error)}), allowing message through`);
    return { shouldRespond: true, rawResponse: "", durationMs: Date.now() - startTime };
  }
}

// ---------------------------------------------------------------------------
// User message construction
// ---------------------------------------------------------------------------

/**
 * Build the user message sent to the triage model, including available context.
 * This gives the triage model enough information to make informed decisions
 * about messages like "yes please" or "can you elaborate?" that only make
 * sense in context.
 */
export function buildTriageUserMessage(params: {
  content: string;
  senderName?: string;
  recentMessages?: Array<{ role: string; content: string }>;
}): string {
  const parts: string[] = [];

  if (params.senderName) {
    parts.push(`From: ${params.senderName}`);
  }

  parts.push(`Message: ${params.content}`);

  if (params.recentMessages?.length) {
    parts.push("");
    parts.push(formatMessageHistory(params.recentMessages));
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Bypass keyword check
// ---------------------------------------------------------------------------

/**
 * Check whether the message content contains any of the configured bypass
 * keywords.  Matching is case-insensitive and uses substring containment.
 *
 * @returns The first matched keyword (lowercased), or `null` if none match.
 */
export function containsBypassKeyword(
  content: string,
  keywords: string[],
): string | null {
  if (!content || keywords.length === 0) return null;

  const lowerContent = content.toLowerCase();
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    if (lowerContent.includes(lowerKeyword)) {
      return lowerKeyword;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Message history formatting
// ---------------------------------------------------------------------------

const MAX_MESSAGE_CONTENT_LENGTH = 200;

/**
 * Format an array of recent messages into a human-readable string for the
 * triage prompt. Each message is rendered as "- [role]: [content]".
 *
 * Message content longer than 200 characters is truncated with "...".
 * Returns an empty string for an empty array.
 */
export function formatMessageHistory(
  messages: Array<{ role: string; content: string }>,
): string {
  if (messages.length === 0) return "";

  const lines = messages.map(({ role, content }) => {
    const truncated =
      content.length > MAX_MESSAGE_CONTENT_LENGTH
        ? content.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + "..."
        : content;
    return `- ${role}: ${truncated}`;
  });

  return `Recent conversation:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the triage model's response into a boolean decision.
 *
 * Looks for "RESPOND" or "SKIP" in the response text.
 * If unclear, defaults to true (respond) to avoid dropping messages.
 */
export function parseTriageDecision(response: string): boolean {
  const normalized = response.toUpperCase().trim();

  if (normalized.startsWith("SKIP")) return false;
  if (normalized.startsWith("RESPOND")) return true;

  // If the response doesn't clearly match either, default to responding.
  // This is intentional — false negatives (bot stays silent when it shouldn't)
  // are worse than false positives (bot responds when it didn't need to).
  return true;
}

/**
 * Parse a confidence score (1-10) from the triage model's response.
 *
 * Extraction strategy:
 *   1. Look for the first integer 1-10 in the text
 *   2. Fall back to keyword matching: "RESPOND" -> 10, "SKIP" -> 1
 *   3. Default to 10 for ambiguous/empty responses (safe default — respond)
 */
export function parseConfidenceScore(response: string): number {
  const trimmed = response.trim();

  // Try to extract the first integer 1-10 from the response
  const match = trimmed.match(/\b(10|[1-9])\b/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Backward compatibility: map RESPOND/SKIP keywords to scores
  const upper = trimmed.toUpperCase();
  if (upper.startsWith("RESPOND")) return 10;
  if (upper.startsWith("SKIP")) return 1;

  // Default to 10 (respond) for ambiguous or empty input.
  // Same philosophy as parseTriageDecision: better to respond than drop.
  return 10;
}
