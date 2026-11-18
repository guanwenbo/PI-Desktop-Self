import { describe, expect, it } from "vitest";
import {
  askToolOptionImpact,
  formatAskToolOutput,
  isAskToolQuestionWithinLimit,
  MAX_ASK_TOOL_QUESTION_CHARS,
  normalizeAskToolOption,
  type AskToolQuestion,
} from "./types.js";

describe("asktool output", () => {
  const questions: AskToolQuestion[] = [
    { question: "Preferred color?", options: ["Blue", "Green"] },
    {
      question: "Which platforms?",
      options: [
        { label: "**Web**", description: "Runs in a browser." },
        { label: "Desktop", description: "Installs on the user's computer." },
      ],
      multiSelect: true,
    },
  ];

  it("serializes each question with selected answers and a stable separator", () => {
    expect(formatAskToolOutput(questions, [["Blue"], ["**Web**", "Desktop"]])).toBe(
      "Preferred color?：Blue\n---\nWhich platforms?：**Web**、Desktop",
    );
  });

  it("keeps skipped answers as empty placeholders", () => {
    expect(formatAskToolOutput(questions, [null, ["Desktop"]])).toBe(
      "Preferred color?：\n---\nWhich platforms?：Desktop",
    );
  });

  it("limits questions to 300 Unicode characters", () => {
    expect(isAskToolQuestionWithinLimit("q".repeat(MAX_ASK_TOOL_QUESTION_CHARS))).toBe(true);
    expect(isAskToolQuestionWithinLimit("q".repeat(MAX_ASK_TOOL_QUESTION_CHARS + 1))).toBe(false);
    expect(isAskToolQuestionWithinLimit("🧭".repeat(MAX_ASK_TOOL_QUESTION_CHARS))).toBe(true);
    expect(isAskToolQuestionWithinLimit("🧭".repeat(MAX_ASK_TOOL_QUESTION_CHARS + 1))).toBe(false);
  });
});

describe("asktool option impact", () => {
  it("keeps the structured consequence a model wrote for one option", () => {
    const option = normalizeAskToolOption({
      label: "Rewrite the parser",
      description: "Cleaner, but touches every caller.",
      impact: {
        summary: "Replaces the hand-written parser with a grammar.",
        changes: ["Swap parser.ts", "Regenerate the fixture set"],
        files: ["src/parser.ts", "test/fixtures/*.json"],
        effects: ["Error messages gain line numbers"],
        risk: "Medium: the fixtures cover only half the grammar.",
        cost: "About three rounds",
        reversible: false,
      },
    });
    expect(askToolOptionImpact(option!)).toEqual({
      summary: "Replaces the hand-written parser with a grammar.",
      changes: ["Swap parser.ts", "Regenerate the fixture set"],
      files: ["src/parser.ts", "test/fixtures/*.json"],
      effects: ["Error messages gain line numbers"],
      risk: "Medium: the fixtures cover only half the grammar.",
      cost: "About three rounds",
      reversible: false,
    });
  });

  it("drops empty impact fields so the card only renders real sections", () => {
    const option = normalizeAskToolOption({
      label: "Patch in place",
      impact: { summary: "  ", changes: ["", "  "], files: [], reversible: true },
    });
    expect(askToolOptionImpact(option!)).toEqual({ reversible: true });
  });

  it("omits impact entirely when nothing usable remains", () => {
    const option = normalizeAskToolOption({ label: "No detail", impact: {} });
    expect(option).toEqual({ label: "No detail" });
    expect(askToolOptionImpact(option!)).toBeUndefined();
  });

  it("bounds summary, list length, and item width", () => {
    const option = normalizeAskToolOption({
      label: "Runaway",
      impact: {
        summary: "s".repeat(600),
        changes: Array.from({ length: 9 }, (_, index) => `change ${index}`),
        files: ["f".repeat(400)],
      },
    });
    const impact = askToolOptionImpact(option!)!;
    expect(impact.summary!.length).toBeLessThanOrEqual(400);
    expect(impact.summary!.endsWith("…")).toBe(true);
    expect(impact.changes).toHaveLength(6);
    expect(impact.files![0].length).toBeLessThanOrEqual(200);
  });

  it("ignores malformed impact values instead of failing the option", () => {
    const option = normalizeAskToolOption({
      label: "Malformed",
      impact: { summary: 42, changes: "not a list", reversible: "yes" },
    });
    expect(option).toEqual({ label: "Malformed" });
  });

  it("reports no impact for legacy string options", () => {
    expect(askToolOptionImpact("Blue")).toBeUndefined();
  });
});
