/**
 * Thin adapter that maps a provider name to its API endpoint and request format.
 *
 * Supports two API formats:
 *   1. Anthropic Messages API (for Anthropic models)
 *   2. OpenAI-compatible Chat Completions API (for everything else)
 *
 * Future: add more provider-specific formats here as needed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderAdapter = {
  /** Full URL to POST the request to. */
  endpoint: string;

  /** Build the fetch request body for this provider. */
  buildRequestBody: (params: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxTokens: number;
  }) => string;

  /** Build the request headers (including auth). */
  buildHeaders: (apiKey: string) => Record<string, string>;

  /** Extract the text response from the API response body. */
  extractResponse: (body: unknown) => string;
};

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

const anthropicAdapter: ProviderAdapter = {
  endpoint: "https://api.anthropic.com/v1/messages",

  buildRequestBody({ model, systemPrompt, userMessage, maxTokens }) {
    return JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
  },

  buildHeaders(apiKey) {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  },

  extractResponse(body) {
    const msg = body as { content?: Array<{ type: string; text?: string }> };
    const textBlock = msg.content?.find((b) => b.type === "text");
    return textBlock?.text?.trim() ?? "";
  },
};

// ---------------------------------------------------------------------------
// OpenAI-compatible Chat Completions API
// Used for OpenAI, OpenRouter, MiniMax, and other compatible providers.
// ---------------------------------------------------------------------------

/**
 * Known base URLs for providers that use the OpenAI-compatible format.
 * If a provider isn't listed here, we fall back to OpenAI's endpoint.
 */
const OPENAI_COMPATIBLE_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  minimax: "https://openrouter.ai/api/v1/chat/completions",
};

function createOpenAICompatibleAdapter(provider: string): ProviderAdapter {
  const endpoint =
    OPENAI_COMPATIBLE_ENDPOINTS[provider] ??
    "https://api.openai.com/v1/chat/completions";

  return {
    endpoint,

    buildRequestBody({ model, systemPrompt, userMessage, maxTokens }) {
      return JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });
    },

    buildHeaders(apiKey) {
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
    },

    extractResponse(body) {
      const resp = body as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return resp.choices?.[0]?.message?.content?.trim() ?? "";
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a "provider/model" string into its two parts.
 *
 * Examples:
 *   "anthropic/claude-haiku-4-5-20251001" → { provider: "anthropic", model: "claude-haiku-4-5-20251001" }
 *   "openai/gpt-4.1-mini" → { provider: "openai", model: "gpt-4.1-mini" }
 *   "minimax/minimax/minimax-m2.5" → { provider: "minimax", model: "minimax/minimax-m2.5" }
 */
export function parseModelString(modelString: string): {
  provider: string;
  model: string;
} {
  const slashIndex = modelString.indexOf("/");
  if (slashIndex === -1) {
    return { provider: "anthropic", model: modelString };
  }
  return {
    provider: modelString.slice(0, slashIndex),
    model: modelString.slice(slashIndex + 1),
  };
}

/**
 * Get the appropriate API adapter for a given provider.
 */
export function getProviderAdapter(provider: string): ProviderAdapter {
  if (provider === "anthropic") {
    return anthropicAdapter;
  }
  return createOpenAICompatibleAdapter(provider);
}
