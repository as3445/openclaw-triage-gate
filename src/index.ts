/**
 * openclaw-triage-gate — A lightweight triage gate for OpenClaw group chats.
 *
 * Registers a `before_dispatch` hook that intercepts group chat messages.
 * For each group message, it calls a cheap model (e.g. Haiku) to decide
 * whether the bot should respond. If the triage model says "SKIP", the
 * main model (e.g. Opus) never runs — saving tokens and money.
 *
 * DMs always pass through without triage.
 */

import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { evaluateMessage } from "./triage.js";
import { type TriageGateConfig } from "./config.js";

// Guard against multiple registrations. OpenClaw calls register() for each
// agent context, but we only need one before_dispatch hook globally.
let registered = false;

export default definePluginEntry({
  id: "openclaw-triage-gate",
  name: "Triage Gate",
  description:
    "Uses a cheap model to decide if the bot should respond in group chats, saving 75-90% of group chat token costs.",

  register(api: OpenClawPluginApi) {
    if (registered) return;
    registered = true;

    const config = (api.pluginConfig ?? {}) as TriageGateConfig;
    const logDecisions = config.logDecisions !== false; // default: true

    // Pre-compute the set of groups to include/exclude for fast lookups
    const includeGroups = config.groups?.length
      ? new Set(config.groups)
      : null; // null = all groups
    const excludeGroups = config.excludeGroups?.length
      ? new Set(config.excludeGroups)
      : null;

    /**
     * Resolve an API key for a provider/model using OpenClaw's auth system.
     * This keeps the plugin model-agnostic — it works with any provider
     * the user has configured in OpenClaw.
     */
    async function resolveApiKey(provider: string, _model: string): Promise<string> {
      try {
        const result = await api.runtime.modelAuth.resolveApiKeyForProvider({
          provider,
        });
        return result?.apiKey ?? "";
      } catch {
        return "";
      }
    }

    // Register the before_dispatch hook. This fires for every inbound message
    // BEFORE the main agent (Opus, Sonnet, etc.) processes it.
    api.on("before_dispatch", async (event) => {
      // Only triage group messages — DMs always go through
      if (!event.isGroup) {
        return; // undefined = no decision, proceed normally
      }

      // Check if this group should be triaged
      const groupId = event.sessionKey ?? "";
      if (excludeGroups?.has(groupId)) {
        return; // This group is excluded from triage
      }
      if (includeGroups && !includeGroups.has(groupId)) {
        return; // This group isn't in the include list
      }

      // Skip triage for very short messages (likely reactions or stickers)
      if (!event.content || event.content.trim().length < 2) {
        return { handled: true }; // Skip silently
      }

      // Run the triage model
      const result = await evaluateMessage({
        content: event.content,
        config,
        resolveApiKey,
        logger: logDecisions ? api.logger : undefined,
      });

      if (logDecisions) {
        const decision = result.shouldRespond ? "RESPOND" : "SKIP";
        api.logger.info?.(
          `triage-gate: ${decision} (${result.durationMs}ms) — "${event.content.slice(0, 80)}"`,
        );
      }

      if (!result.shouldRespond) {
        // Tell OpenClaw to skip the main agent for this message
        return { handled: true };
      }

      // Let the message through to the main agent
      return; // undefined = proceed normally
    });

    api.logger.info?.("triage-gate: plugin loaded");
  },
});
