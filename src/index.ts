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
import { evaluateMessage, containsBypassKeyword } from "./triage.js";
import { type TriageGateConfig } from "./config.js";

// Guard against multiple registrations. OpenClaw calls register() for each
// agent context, but we only need one before_dispatch hook globally.
let registered = false;

/**
 * In-memory ring buffer that accumulates recent messages per group.
 * Keyed by sessionKey (group ID). Resets on plugin restart — this is
 * acceptable for triage context since it's best-effort.
 */
const groupHistoryBuffers = new Map<
  string,
  Array<{ role: string; content: string; ts: number }>
>();

/** Evict groups with no activity in the last hour to prevent unbounded growth. */
const EVICT_AFTER_MS = 60 * 60 * 1000;

function pushToBuffer(
  groupId: string,
  senderId: string,
  content: string,
  maxSize: number,
): void {
  let buffer = groupHistoryBuffers.get(groupId);
  if (!buffer) {
    buffer = [];
    groupHistoryBuffers.set(groupId, buffer);
  }
  buffer.push({ role: senderId, content, ts: Date.now() });
  // Keep only the last maxSize entries
  if (buffer.length > maxSize) {
    buffer.splice(0, buffer.length - maxSize);
  }
}

function getBufferedHistory(
  groupId: string,
  count: number,
): Array<{ role: string; content: string }> | undefined {
  const buffer = groupHistoryBuffers.get(groupId);
  if (!buffer?.length) return undefined;
  return buffer.slice(-count).map(({ role, content }) => ({ role, content }));
}

function evictStaleBuffers(): void {
  const cutoff = Date.now() - EVICT_AFTER_MS;
  for (const [key, buffer] of groupHistoryBuffers) {
    if (!buffer.length || buffer[buffer.length - 1].ts < cutoff) {
      groupHistoryBuffers.delete(key);
    }
  }
}

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
    const historyCount = Math.min(Math.max(config.historyCount ?? 0, 0), 20);

    // Resolve bot name: explicit config > first agent's identity.name from OpenClaw config
    const ocConfig = api.config as { agents?: { list?: Array<{ identity?: { name?: string } }> } };
    const agentIdentityName = ocConfig.agents?.list?.[0]?.identity?.name;
    const botNameLower = (config.botName ?? agentIdentityName ?? "").toLowerCase();

    // Pre-compute the set of groups to include/exclude for fast lookups
    const includeGroups = config.groups?.length
      ? new Set(config.groups)
      : null; // null = all groups
    const excludeGroups = config.excludeGroups?.length
      ? new Set(config.excludeGroups)
      : null;

    // Periodically evict stale group buffers (every 10 minutes)
    if (historyCount > 0) {
      setInterval(evictStaleBuffers, 10 * 60 * 1000);
    }

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

      // Always respond when the bot's name is mentioned in the message
      if (botNameLower && event.content.toLowerCase().includes(botNameLower)) {
        if (logDecisions) {
          api.logger.info?.(`triage-gate: RESPOND (bot name mentioned) — "${event.content.slice(0, 80)}"`);
        }
        // Still record in history buffer before passing through
        if (historyCount > 0) {
          pushToBuffer(groupId, event.senderId ?? "unknown", event.content, historyCount);
        }
        return; // let message through without triage
      }

      // Check for bypass keywords — if matched, skip triage entirely
      if (config.bypassKeywords?.length) {
        const matched = containsBypassKeyword(event.content, config.bypassKeywords);
        if (matched) {
          if (logDecisions) {
            api.logger.info?.(`triage-gate: BYPASS (keyword: ${matched})`);
          }
          if (historyCount > 0) {
            pushToBuffer(groupId, event.senderId ?? "unknown", event.content, historyCount);
          }
          return; // undefined = let message through without triage
        }
      }

      // Get recent messages from the in-memory buffer
      const recentMessages = historyCount > 0
        ? getBufferedHistory(groupId, historyCount)
        : undefined;

      // Record this message in the buffer (after reading history so this
      // message isn't included as "recent" context for itself)
      if (historyCount > 0) {
        pushToBuffer(groupId, event.senderId ?? "unknown", event.content, historyCount);
      }

      // Run the triage model
      const result = await evaluateMessage({
        content: event.content,
        senderName: event.senderId,
        config,
        resolveApiKey,
        logger: logDecisions ? api.logger : undefined,
        recentMessages,
      });

      if (logDecisions) {
        const decision = result.shouldRespond ? "RESPOND" : "SKIP";
        const scoreInfo = result.confidenceScore != null
          ? `score: ${result.confidenceScore}/10, `
          : "";
        api.logger.info?.(
          `triage-gate: ${decision} (${scoreInfo}${result.durationMs}ms) — "${event.content.slice(0, 80)}"`,
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
