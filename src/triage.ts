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
  type TriageGateConfig,
} from "./config.js";
import { parseModelString, getProviderAdapter } from "./providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriageParams = {
  /** The message content to evaluate. */
  content: string;

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
};

export type TriageResult = {
  /** Whether the bot should respond to this message. */
  shouldRespond: boolean;

  /** The raw response from the triage model (for debugging). */
  rawResponse: string;

  /** How long the triage call took in milliseconds. */
  durationMs: number;
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
  const { content, config, resolveApiKey, logger } = params;
  const startTime = Date.now();

  const modelString = config.triageModel ?? DEFAULT_TRIAGE_MODEL;
  const { provider, model } = parseModelString(modelString);
  const prompt = config.triagePrompt ?? DEFAULT_TRIAGE_PROMPT;
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

    // Make the API call
    const response = await fetch(adapter.endpoint, {
      method: "POST",
      headers: adapter.buildHeaders(apiKey),
      body: adapter.buildRequestBody({
        model,
        systemPrompt: prompt,
        userMessage: `Message: ${content}`,
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
