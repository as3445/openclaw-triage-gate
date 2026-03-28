# Roadmap

Future enhancements planned for openclaw-triage-gate. None of these are committed to a timeline — they'll be built as needed.

## Implemented

### Keyword bypass list
Always respond to messages containing certain keywords regardless of triage (e.g. "help", "urgent", the bot's name). Simple case-insensitive substring matching — no model call needed. Configure via `bypassKeywords` in the plugin config.

### Confidence scores with configurable threshold
Instead of binary RESPOND/SKIP, the triage model returns a confidence score (1-10). Users configure a threshold — messages scoring at or above it proceed to the main model. Enable with `useConfidenceScores: true` and tune via `confidenceThreshold` (default: 5).

### Recent message history in triage context
Include the last N messages from the group conversation in the triage prompt. This gives the triage model better context for deciding whether the bot should respond (e.g. understanding ongoing threads, follow-up questions). Configure via `historyCount` (default: 0, max: 20). Trade-off: increases triage token cost by ~500-1000 tokens per call.

## Planned

### Custom per-group triage prompts
Different groups may need different triage criteria. A caregiving group might want the bot to respond more aggressively, while a social group should be more conservative. Allow `triagePrompt` to be overridden per group ID.

### Analytics and metrics
Track triage decisions over time: hit/miss ratio, tokens saved, false negatives, response times. Expose via a CLI command or dashboard. Helps users tune their triage prompt and verify cost savings.

### Rate-based bypass
In quiet groups (low message rate), skip triage and always respond. The cost savings from triage matter most in active groups. Configurable threshold (e.g. "if fewer than 5 messages in the last hour, skip triage").

### Feedback loop
Let users mark false negatives ("the bot should have responded to this") via a reaction or command. Store these examples and optionally include them in the triage prompt as few-shot examples.

## Considered but not planned

### Non-Anthropic/OpenAI provider formats
Currently supports Anthropic Messages API and OpenAI-compatible Chat Completions API. Other provider formats (e.g. Google Gemini, Cohere) could be added to `providers.ts` if there's demand.
