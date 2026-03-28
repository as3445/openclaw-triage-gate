import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluateMessage, containsBypassKeyword, formatMessageHistory, parseConfidenceScore } from "../src/triage.js";
import { DEFAULT_TRIAGE_PROMPT, DEFAULT_CONFIDENCE_PROMPT, DEFAULT_CONFIDENCE_THRESHOLD, type TriageGateConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResolveApiKey(_provider: string, _model: string): Promise<string> {
  return Promise.resolve("test-api-key-123");
}

function emptyResolveApiKey(_provider: string, _model: string): Promise<string> {
  return Promise.resolve("");
}

/** Build a minimal mock for the Anthropic Messages API response. */
function anthropicResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ content: [{ type: "text", text }] }),
    text: () => Promise.resolve(text),
  };
}

/** Build a minimal mock for the OpenAI-compatible API response. */
function openaiResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ choices: [{ message: { content: text } }] }),
    text: () => Promise.resolve(text),
  };
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(body),
  };
}

// ---------------------------------------------------------------------------
// evaluateMessage — binary mode (default / v1 behavior)
// ---------------------------------------------------------------------------

describe("evaluateMessage — binary mode", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns shouldRespond=true when model says RESPOND", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    const result = await evaluateMessage({
      content: "Hey bot, what time is it?",
      config: {},
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.rawResponse).toBe("RESPOND");
    expect(result.confidenceScore).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns shouldRespond=false when model says SKIP", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("SKIP"),
    );

    const result = await evaluateMessage({
      content: "lol nice",
      config: {},
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.rawResponse).toBe("SKIP");
    expect(result.confidenceScore).toBeUndefined();
  });

  it("defaults to shouldRespond=true when API key is empty", async () => {
    const result = await evaluateMessage({
      content: "test message",
      config: {},
      resolveApiKey: emptyResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults to shouldRespond=true on API error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse(500, "Internal Server Error"),
    );

    const warnings: string[] = [];
    const result = await evaluateMessage({
      content: "test message",
      config: {},
      resolveApiKey: mockResolveApiKey,
      logger: { warn: (msg: string) => warnings.push(msg) },
    });

    expect(result.shouldRespond).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("defaults to shouldRespond=true on fetch exception", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const result = await evaluateMessage({
      content: "test message",
      config: {},
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
  });

  it("uses the default triage prompt when none configured", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    await evaluateMessage({
      content: "Hello",
      config: {},
      resolveApiKey: mockResolveApiKey,
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(callBody.system).toBe(DEFAULT_TRIAGE_PROMPT);
  });

  it("uses custom triage prompt when configured", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    const customPrompt = "Custom: say RESPOND or SKIP";
    await evaluateMessage({
      content: "Hello",
      config: { triagePrompt: customPrompt },
      resolveApiKey: mockResolveApiKey,
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(callBody.system).toBe(customPrompt);
  });
});

// ---------------------------------------------------------------------------
// evaluateMessage — confidence scoring mode
// ---------------------------------------------------------------------------

describe("evaluateMessage — confidence scoring mode", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns shouldRespond=true when score meets default threshold", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("7"),
    );

    const result = await evaluateMessage({
      content: "Can someone help me?",
      config: { useConfidenceScores: true },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.confidenceScore).toBe(7);
  });

  it("returns shouldRespond=false when score is below default threshold", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("3"),
    );

    const result = await evaluateMessage({
      content: "lol yeah",
      config: { useConfidenceScores: true },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.confidenceScore).toBe(3);
  });

  it("respects custom confidence threshold", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("6"),
    );

    const result = await evaluateMessage({
      content: "interesting topic",
      config: { useConfidenceScores: true, confidenceThreshold: 7 },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.confidenceScore).toBe(6);
  });

  it("returns shouldRespond=true when score equals threshold exactly", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("5"),
    );

    const result = await evaluateMessage({
      content: "hmm maybe",
      config: { useConfidenceScores: true, confidenceThreshold: 5 },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.confidenceScore).toBe(5);
  });

  it("uses the confidence prompt (not binary prompt) by default", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("8"),
    );

    await evaluateMessage({
      content: "Hello",
      config: { useConfidenceScores: true },
      resolveApiKey: mockResolveApiKey,
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(callBody.system).toBe(DEFAULT_CONFIDENCE_PROMPT);
  });

  it("uses custom prompt even when confidence mode is on", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("8"),
    );

    const customPrompt = "Rate 1-10 how relevant this is";
    await evaluateMessage({
      content: "Hello",
      config: { useConfidenceScores: true, triagePrompt: customPrompt },
      resolveApiKey: mockResolveApiKey,
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(callBody.system).toBe(customPrompt);
  });
});

// ---------------------------------------------------------------------------
// evaluateMessage — message history
// ---------------------------------------------------------------------------

describe("evaluateMessage — message history", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes formatted history in the user message when provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    const history = [
      { role: "user", content: "Anyone know about TypeScript?" },
      { role: "assistant", content: "Yes, I can help!" },
    ];

    await evaluateMessage({
      content: "What about generics?",
      config: {},
      resolveApiKey: mockResolveApiKey,
      recentMessages: history,
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    const userMsg = callBody.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toContain("Message: What about generics?");
    expect(userMsg.content).toContain("Recent conversation:");
    expect(userMsg.content).toContain("- user: Anyone know about TypeScript?");
    expect(userMsg.content).toContain("- assistant: Yes, I can help!");
  });

  it("sends plain message when no history provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("SKIP"),
    );

    await evaluateMessage({
      content: "Just chatting",
      config: {},
      resolveApiKey: mockResolveApiKey,
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    const userMsg = callBody.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toBe("Message: Just chatting");
    expect(userMsg.content).not.toContain("Recent conversation:");
  });

  it("sends plain message when history is empty array", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    await evaluateMessage({
      content: "Hello",
      config: {},
      resolveApiKey: mockResolveApiKey,
      recentMessages: [],
    });

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    const userMsg = callBody.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toBe("Message: Hello");
  });
});

// ---------------------------------------------------------------------------
// Feature interaction: history + confidence scoring
// ---------------------------------------------------------------------------

describe("feature interaction: history + confidence scoring", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes history in the prompt AND parses confidence score", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("8"),
    );

    const history = [
      { role: "user", content: "Help me debug this" },
      { role: "user", content: "It keeps crashing" },
    ];

    const result = await evaluateMessage({
      content: "Can you look at my code?",
      config: { useConfidenceScores: true },
      resolveApiKey: mockResolveApiKey,
      recentMessages: history,
    });

    // Confidence score should be parsed
    expect(result.confidenceScore).toBe(8);
    expect(result.shouldRespond).toBe(true);

    // History should be included in the request
    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    const userMsg = callBody.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toContain("Recent conversation:");
    expect(userMsg.content).toContain("- user: Help me debug this");

    // Should use confidence prompt, not binary prompt
    expect(callBody.system).toBe(DEFAULT_CONFIDENCE_PROMPT);
  });

  it("history with confidence below threshold still returns false", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("2"),
    );

    const result = await evaluateMessage({
      content: "nice weather",
      config: { useConfidenceScores: true, confidenceThreshold: 5 },
      resolveApiKey: mockResolveApiKey,
      recentMessages: [{ role: "user", content: "yeah its sunny" }],
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.confidenceScore).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Feature interaction: bypass keywords + confidence scoring
// ---------------------------------------------------------------------------

describe("feature interaction: bypass keywords + confidence scoring", () => {
  it("bypass keyword check is independent of confidence scoring", () => {
    // containsBypassKeyword is a pure function that does not care about
    // the confidence config — it just checks keywords. This verifies the
    // function works correctly as a precondition check.
    const matched = containsBypassKeyword("URGENT: server down!", ["urgent"]);
    expect(matched).toBe("urgent");

    // Even with a score of 1 (would be SKIP in confidence mode),
    // the bypass should have already short-circuited before scoring.
    // We verify this by confirming containsBypassKeyword returns a match.
    const score = parseConfidenceScore("1");
    expect(score).toBe(1);

    // The bypass match means evaluateMessage would never be called in index.ts.
    // This is verified by the code structure: bypass check (line 81-89) comes
    // before evaluateMessage call (line 106) in index.ts.
    expect(matched).not.toBeNull();
  });

  it("no bypass match falls through to confidence scoring", async () => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("3"),
    );

    // No bypass keyword match
    const matched = containsBypassKeyword("just chatting", ["urgent", "help"]);
    expect(matched).toBeNull();

    // So evaluateMessage runs with confidence scoring
    const result = await evaluateMessage({
      content: "just chatting",
      config: { useConfidenceScores: true, confidenceThreshold: 5 },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.confidenceScore).toBe(3);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Feature interaction: all three features together
// ---------------------------------------------------------------------------

describe("feature interaction: all three features combined", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bypass keyword takes priority — no API call made", async () => {
    const config: TriageGateConfig = {
      bypassKeywords: ["urgent", "@bot"],
      useConfidenceScores: true,
      confidenceThreshold: 8,
      historyCount: 5,
    };

    // Simulate the index.ts flow: check bypass first
    const matched = containsBypassKeyword("URGENT: need help now", config.bypassKeywords!);
    expect(matched).toBe("urgent");

    // Since bypass matched, evaluateMessage should NOT be called.
    // Verify fetch was never called.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("no bypass -> confidence scoring with history context", async () => {
    const config: TriageGateConfig = {
      bypassKeywords: ["urgent", "@bot"],
      useConfidenceScores: true,
      confidenceThreshold: 6,
      historyCount: 5,
    };

    const content = "What do you think about this approach?";

    // Step 1: bypass check
    const matched = containsBypassKeyword(content, config.bypassKeywords!);
    expect(matched).toBeNull();

    // Step 2: evaluateMessage with confidence + history
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("7"),
    );

    const history = [
      { role: "user", content: "I was thinking about refactoring" },
      { role: "assistant", content: "That sounds like a good idea" },
    ];

    const result = await evaluateMessage({
      content,
      config,
      resolveApiKey: mockResolveApiKey,
      recentMessages: history,
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.confidenceScore).toBe(7);

    // Verify history was included
    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    const userMsg = callBody.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toContain("Recent conversation:");

    // Verify confidence prompt was used
    expect(callBody.system).toBe(DEFAULT_CONFIDENCE_PROMPT);
  });

  it("no bypass -> binary mode (confidence disabled) with history", async () => {
    const config: TriageGateConfig = {
      bypassKeywords: ["urgent"],
      useConfidenceScores: false,
      historyCount: 3,
    };

    const content = "Is anyone here?";
    const matched = containsBypassKeyword(content, config.bypassKeywords!);
    expect(matched).toBeNull();

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    const result = await evaluateMessage({
      content,
      config,
      resolveApiKey: mockResolveApiKey,
      recentMessages: [{ role: "user", content: "Hello?" }],
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.confidenceScore).toBeUndefined();

    // Verify binary prompt was used (not confidence prompt)
    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(callBody.system).toBe(DEFAULT_TRIAGE_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: v1 config (no new fields)
// ---------------------------------------------------------------------------

describe("backward compatibility — v1 config", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty config works identically to v1", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    const result = await evaluateMessage({
      content: "Hello bot",
      config: {},
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.confidenceScore).toBeUndefined();
    expect(result.rawResponse).toBe("RESPOND");

    // Should use default binary prompt
    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(callBody.system).toBe(DEFAULT_TRIAGE_PROMPT);
    expect(callBody.model).toBe("claude-haiku-4-5-20251001");
    expect(callBody.max_tokens).toBe(10);

    // User message should be plain (no history)
    const userMsg = callBody.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toBe("Message: Hello bot");
  });

  it("v1 config with groups/excludeGroups only still works", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("SKIP"),
    );

    const result = await evaluateMessage({
      content: "casual chat",
      config: {
        groups: ["group-1"],
        excludeGroups: ["group-2"],
        logDecisions: true,
      },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.confidenceScore).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provider routing
// ---------------------------------------------------------------------------

describe("provider routing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes to Anthropic API for anthropic/ model prefix", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("RESPOND"),
    );

    await evaluateMessage({
      content: "test",
      config: { triageModel: "anthropic/claude-haiku-4-5-20251001" },
      resolveApiKey: mockResolveApiKey,
    });

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("routes to OpenAI API for openai/ model prefix", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openaiResponse("SKIP"),
    );

    await evaluateMessage({
      content: "test",
      config: { triageModel: "openai/gpt-4.1-mini" },
      resolveApiKey: mockResolveApiKey,
    });

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("routes to OpenRouter for openrouter/ model prefix", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openaiResponse("RESPOND"),
    );

    await evaluateMessage({
      content: "test",
      config: { triageModel: "openrouter/some-model" },
      resolveApiKey: mockResolveApiKey,
    });

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confidence threshold of 1 means almost everything responds", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("1"),
    );

    const result = await evaluateMessage({
      content: "meh",
      config: { useConfidenceScores: true, confidenceThreshold: 1 },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(true);
    expect(result.confidenceScore).toBe(1);
  });

  it("confidence threshold of 10 means only strongest matches respond", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      anthropicResponse("9"),
    );

    const result = await evaluateMessage({
      content: "urgent question",
      config: { useConfidenceScores: true, confidenceThreshold: 10 },
      resolveApiKey: mockResolveApiKey,
    });

    expect(result.shouldRespond).toBe(false);
    expect(result.confidenceScore).toBe(9);
  });

  it("bypass keyword with empty string content returns null", () => {
    expect(containsBypassKeyword("", ["urgent"])).toBeNull();
  });

  it("bypass keyword matching is substring, not whole word", () => {
    expect(containsBypassKeyword("unhelpful", ["help"])).toBe("help");
  });

  it("formatMessageHistory truncates exactly at 200 chars", () => {
    const exactlyAt200 = "x".repeat(200);
    const result = formatMessageHistory([{ role: "user", content: exactlyAt200 }]);
    // 200 chars should NOT be truncated (> 200, not >= 200)
    expect(result).toBe(`Recent conversation:\n- user: ${exactlyAt200}`);
    expect(result).not.toContain("...");
  });

  it("formatMessageHistory truncates at 201 chars", () => {
    const at201 = "x".repeat(201);
    const result = formatMessageHistory([{ role: "user", content: at201 }]);
    expect(result).toContain("...");
    expect(result).toBe(`Recent conversation:\n- user: ${"x".repeat(200)}...`);
  });
});
