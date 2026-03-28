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

  /**
   * Keywords that bypass triage entirely. When a message contains any of
   * these keywords (case-insensitive substring match), the bot always
   * responds without calling the triage model.
   */
  bypassKeywords?: string[];

  /**
   * When true, the triage model returns a 1-10 confidence score instead
   * of binary RESPOND/SKIP. Messages scoring at or above the threshold
   * proceed to the main model.
   * Default: false
   */
  useConfidenceScores?: boolean;

  /**
   * Confidence threshold (1-10). Messages with a score at or above this
   * value proceed to the main model. Only used when useConfidenceScores
   * is true.
   * Default: 5
   */
  confidenceThreshold?: number;

  /**
   * Number of recent group messages to include in the triage prompt for
   * additional context. Helps the model make better decisions by seeing
   * the conversation flow.
   * Default: 0 (disabled), Max: 20
   */
  historyCount?: number;
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

/** Default confidence threshold when useConfidenceScores is enabled. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 5;

/** Default number of recent messages to include in triage context. */
export const DEFAULT_HISTORY_COUNT = 0;

/**
 * The built-in confidence-scoring prompt. Instructs the model to reply
 * with a single number 1-10 indicating response likelihood.
 */
export const DEFAULT_CONFIDENCE_PROMPT = `Reply with a single number 1-10 indicating how likely the bot should respond. 1 = definitely skip, 10 = definitely respond. Reply with ONLY the number.`;
