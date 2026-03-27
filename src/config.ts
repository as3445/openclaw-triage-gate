/**
 * Configuration for the triage-gate plugin.
 *
 * All fields are optional — sensible defaults are used when omitted.
 */
export type TriageGateConfig = {
  /**
   * Model to use for triage decisions, in "provider/model" format.
   *
   * Examples:
   *   "anthropic/claude-haiku-4-5-20251001"
   *   "minimax/minimax-m2.5"
   *   "openai/gpt-4.1-mini"
   *
   * The plugin resolves the API key from OpenClaw's configured providers —
   * no need to put API keys in the plugin config.
   *
   * Default: "anthropic/claude-haiku-4-5-20251001"
   */
  triageModel?: string;

  /**
   * Custom prompt for triage decisions. Replaces the built-in default.
   * Must instruct the model to reply with exactly "RESPOND" or "SKIP".
   *
   * The message content is appended after this prompt.
   */
  triagePrompt?: string;

  /**
   * Only apply triage to these group IDs. When empty or omitted,
   * triage applies to ALL group chats.
   */
  groups?: string[];

  /**
   * Skip triage for these group IDs — messages in these groups
   * always proceed to the main model.
   */
  excludeGroups?: string[];

  /**
   * Max output tokens for the triage model response.
   * Keep this low — we only need "RESPOND" or "SKIP".
   * Default: 10
   */
  maxTriageTokens?: number;

  /**
   * Whether to log each triage decision.
   * Default: true
   */
  logDecisions?: boolean;
};

/** The default triage model when none is configured. */
export const DEFAULT_TRIAGE_MODEL = "anthropic/claude-haiku-4-5-20251001";

/** The default max output tokens for a triage call. */
export const DEFAULT_MAX_TRIAGE_TOKENS = 10;

/**
 * The built-in triage prompt. Instructs the model to reply with
 * exactly "RESPOND" or "SKIP" based on whether the bot should reply.
 */
export const DEFAULT_TRIAGE_PROMPT = `You are a message triage system for a group chat bot.
Decide if the bot should respond to this message.

Reply ONLY with "RESPOND" or "SKIP". Nothing else.

RESPOND when:
- The bot is directly addressed by name or asked a question
- The bot can add genuine value (information, help, insight)
- Something urgent or important is happening
- Correcting significant misinformation

SKIP when:
- Casual banter between people
- Someone already answered the question
- A response would just be acknowledgment ("nice", "yeah", "lol")
- The conversation is flowing fine without the bot
- The message is a reaction, emoji, or sticker`;
