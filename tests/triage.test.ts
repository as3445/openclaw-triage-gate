import { describe, it, expect } from "vitest";
import { parseTriageDecision, parseConfidenceScore, containsBypassKeyword, formatMessageHistory, buildTriageUserMessage } from "../src/triage.js";

describe("parseTriageDecision", () => {
  it("returns false for SKIP", () => {
    expect(parseTriageDecision("SKIP")).toBe(false);
  });

  it("returns false for SKIP with trailing text", () => {
    expect(parseTriageDecision("SKIP - casual banter")).toBe(false);
  });

  it("returns false for lowercase skip", () => {
    expect(parseTriageDecision("skip")).toBe(false);
  });

  it("returns false for skip with whitespace", () => {
    expect(parseTriageDecision("  SKIP  ")).toBe(false);
  });

  it("returns true for RESPOND", () => {
    expect(parseTriageDecision("RESPOND")).toBe(true);
  });

  it("returns true for RESPOND with trailing text", () => {
    expect(parseTriageDecision("RESPOND - user asked a question")).toBe(true);
  });

  it("returns true for lowercase respond", () => {
    expect(parseTriageDecision("respond")).toBe(true);
  });

  it("returns true for respond with whitespace", () => {
    expect(parseTriageDecision("  RESPOND  ")).toBe(true);
  });

  it("defaults to true for ambiguous response", () => {
    expect(parseTriageDecision("I think the bot should reply")).toBe(true);
  });

  it("defaults to true for empty response", () => {
    expect(parseTriageDecision("")).toBe(true);
  });

  it("defaults to true for unexpected output", () => {
    expect(parseTriageDecision("YES")).toBe(true);
  });
});

describe("parseConfidenceScore", () => {
  it("returns 7 for '7'", () => {
    expect(parseConfidenceScore("7")).toBe(7);
  });

  it("returns 10 for '10'", () => {
    expect(parseConfidenceScore("10")).toBe(10);
  });

  it("returns 1 for '1'", () => {
    expect(parseConfidenceScore("1")).toBe(1);
  });

  it("returns 8 for 'SCORE: 8'", () => {
    expect(parseConfidenceScore("SCORE: 8")).toBe(8);
  });

  it("returns 8 for 'Score: 8/10'", () => {
    expect(parseConfidenceScore("Score: 8/10")).toBe(8);
  });

  it("returns 10 for 'RESPOND' (backward compat)", () => {
    expect(parseConfidenceScore("RESPOND")).toBe(10);
  });

  it("returns 1 for 'SKIP' (backward compat)", () => {
    expect(parseConfidenceScore("SKIP")).toBe(1);
  });

  it("returns 10 for empty string (safe default)", () => {
    expect(parseConfidenceScore("")).toBe(10);
  });

  it("returns 10 for ambiguous text (safe default)", () => {
    expect(parseConfidenceScore("I think maybe")).toBe(10);
  });

  it("returns 3 for '3 - casual conversation'", () => {
    expect(parseConfidenceScore("3 - casual conversation")).toBe(3);
  });
});

describe("containsBypassKeyword", () => {
  it("returns matched keyword for case-insensitive match", () => {
    expect(containsBypassKeyword("URGENT issue here", ["urgent"])).toBe("urgent");
    expect(containsBypassKeyword("this is urgent", ["URGENT"])).toBe("urgent");
  });

  it("returns null when no keywords match", () => {
    expect(containsBypassKeyword("hello world", ["urgent", "help"])).toBeNull();
  });

  it("handles empty keyword array", () => {
    expect(containsBypassKeyword("some message", [])).toBeNull();
  });

  it("handles empty content", () => {
    expect(containsBypassKeyword("", ["urgent"])).toBeNull();
  });

  it("matches partial words (e.g. 'help' matches 'please help me')", () => {
    expect(containsBypassKeyword("please help me", ["help"])).toBe("help");
  });
});

describe("formatMessageHistory", () => {
  it("formats multiple messages correctly", () => {
    const messages = [
      { role: "user", content: "Hello everyone" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
    ];
    const result = formatMessageHistory(messages);
    expect(result).toBe(
      "Recent conversation:\n- user: Hello everyone\n- assistant: Hi there!\n- user: How are you?",
    );
  });

  it("returns empty string for empty array", () => {
    expect(formatMessageHistory([])).toBe("");
  });

  it("handles single message", () => {
    const messages = [{ role: "user", content: "Just one message" }];
    const result = formatMessageHistory(messages);
    expect(result).toBe("Recent conversation:\n- user: Just one message");
  });

  it("truncates message content over 200 chars with '...'", () => {
    const longContent = "a".repeat(250);
    const messages = [{ role: "user", content: longContent }];
    const result = formatMessageHistory(messages);
    expect(result).toBe(`Recent conversation:\n- user: ${"a".repeat(200)}...`);
  });
});

describe("buildTriageUserMessage", () => {
  it("includes only message when no context available", () => {
    const result = buildTriageUserMessage({ content: "hello" });
    expect(result).toBe("Message: hello");
  });

  it("includes sender name when available", () => {
    const result = buildTriageUserMessage({ content: "hello", senderName: "Alice" });
    expect(result).toBe("From: Alice\nMessage: hello");
  });

  it("includes all context when available", () => {
    const result = buildTriageUserMessage({
      content: "can you help?",
      senderName: "Bob",
      recentMessages: [
        { role: "Alice", content: "I have an issue" },
        { role: "Bot", content: "What kind of issue?" },
      ],
    });
    expect(result).toBe(
      "From: Bob\nMessage: can you help?\n\nRecent conversation:\n- Alice: I have an issue\n- Bot: What kind of issue?",
    );
  });

  it("includes history but no sender/group when only history is available", () => {
    const result = buildTriageUserMessage({
      content: "yes",
      recentMessages: [{ role: "someone", content: "want me to proceed?" }],
    });
    expect(result).toBe(
      "Message: yes\n\nRecent conversation:\n- someone: want me to proceed?",
    );
  });
});
