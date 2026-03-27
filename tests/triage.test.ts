import { describe, it, expect } from "vitest";
import { parseTriageDecision } from "../src/triage.js";

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
