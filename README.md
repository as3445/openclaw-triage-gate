# openclaw-triage-gate

A lightweight triage gate for OpenClaw group chats. Uses a cheap model to decide if the bot should respond before the expensive main model runs.

## The Problem

When an OpenClaw bot is in group chats with `requireMention: false`, **every message** triggers the main model (e.g. Opus at $15/M input, $75/M output) — even when the bot decides not to respond (`NO_REPLY`). In active groups, this wastes most of the token budget on messages the bot ignores anyway.

## The Solution

This plugin intercepts group messages **before** the main model runs. It calls a cheap triage model (e.g. Haiku at $1/M input, $5/M output) to make a quick RESPOND/SKIP decision. If the triage model says SKIP, the main model never fires.

```
Group message → Triage model (cheap) → SKIP? → Done ($0.001)
                                      → RESPOND? → Main model (expensive) → Reply
```

DMs always pass through without triage.

## Estimated Savings

Assuming ~80% of group messages don't need a response:

| Scenario | Cost per 100 messages |
|----------|----------------------|
| Without plugin (all Opus) | $5-22 |
| With plugin (Haiku triage) | $1-5 |

**75-90% reduction in group chat token costs.**

## Install

```bash
openclaw plugins install openclaw-triage-gate
```

## Configure

Add to your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "triage-gate": {
        "enabled": true,
        "config": {
          "triageModel": "anthropic/claude-haiku-4-5-20251001"
        }
      }
    }
  }
}
```

Or via CLI:

```bash
openclaw config set plugins.entries.triage-gate.enabled true
openclaw config set plugins.entries.triage-gate.config.triageModel "anthropic/claude-haiku-4-5-20251001"
```

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `triageModel` | string | `anthropic/claude-haiku-4-5-20251001` | Model for triage decisions, in `provider/model` format |
| `triagePrompt` | string | (built-in) | Custom prompt — must instruct the model to reply RESPOND or SKIP |
| `groups` | string[] | all groups | Only apply triage to these group IDs |
| `excludeGroups` | string[] | none | Skip triage for these group IDs |
| `maxTriageTokens` | number | 10 | Max output tokens for triage response |
| `logDecisions` | boolean | true | Log each triage decision |

### Model Examples

Use any model your OpenClaw instance has configured:

```json
{ "triageModel": "anthropic/claude-haiku-4-5-20251001" }
{ "triageModel": "minimax/minimax-m2.5" }
{ "triageModel": "openai/gpt-4.1-mini" }
{ "triageModel": "openrouter/meta-llama/llama-4-scout" }
```

The plugin resolves API keys from OpenClaw's existing provider config — no need to add API keys to the plugin config.

### Custom Triage Prompt

You can customize when the bot responds by providing your own prompt:

```json
{
  "triagePrompt": "You are a triage system. Reply RESPOND if the message needs the bot's attention, SKIP otherwise.\n\nAlways RESPOND to: questions, requests for help, mentions of health or emergencies.\nAlways SKIP: greetings, emoji reactions, casual chat."
}
```

## How It Works

1. The plugin registers a `before_dispatch` hook in OpenClaw
2. When a group message arrives, the hook fires before the main agent
3. The plugin calls the configured triage model with the message content
4. If the model says SKIP, the plugin returns `{ handled: true }` — the main agent never runs
5. If the model says RESPOND (or anything unclear), the message proceeds to the main agent normally

On any error (API timeout, missing key, etc.), the plugin defaults to letting the message through. Better to waste some tokens than silently drop messages.

## Future Enhancements

These are planned but not yet implemented:

- Recent message history in triage context for better accuracy
- Per-group custom triage prompts
- Confidence scores with configurable thresholds
- Analytics dashboard (hit/miss ratio, tokens saved)
- Keyword bypass list (always respond to certain words)
- Rate-based bypass (skip triage in quiet groups)

## License

MIT
