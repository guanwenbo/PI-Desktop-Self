import { expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  pruneToolResultMessages,
  TOOL_RESULT_PRUNE_HEAD_CHARS,
  TOOL_RESULT_PRUNE_KEEP_LAST,
  TOOL_RESULT_PRUNE_MIN_CHARS,
  TOOL_RESULT_PRUNE_TAIL_CHARS,
} from "./tool-result-pruner.js";

type ToolResultLike = {
  role: string;
  toolCallId: string;
  toolName: string;
  content: ({ type: string; text: string } | Record<string, unknown>)[];
  isError: boolean;
};

function asResult(message: AgentMessage): ToolResultLike {
  return message as unknown as ToolResultLike;
}

function toolResult(id: string, body: string, timestamp = 1): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "Read",
    content: [{ type: "text", text: body }],
    isError: false,
    timestamp,
  } as unknown as AgentMessage;
}

const BIG = "x".repeat(TOOL_RESULT_PRUNE_MIN_CHARS + 3_000);
const SMALL = "ok";

it("returns the same array when there is nothing to prune", () => {
  const messages = [toolResult("a", BIG)];
  expect(pruneToolResultMessages(messages)).toBe(messages);
});

it("keeps the newest tool results verbatim regardless of size", () => {
  const messages = Array.from({ length: TOOL_RESULT_PRUNE_KEEP_LAST }, (_, index) =>
    toolResult(`call-${index}`, BIG),
  );
  expect(pruneToolResultMessages(messages)).toBe(messages);
});

it("prunes only old oversized results with head, marker, and tail", () => {
  const messages = [
    toolResult("old", BIG),
    toolResult("small-old", SMALL),
    ...Array.from({ length: TOOL_RESULT_PRUNE_KEEP_LAST }, (_, index) =>
      toolResult(`recent-${index}`, BIG),
    ),
  ];
  const pruned = pruneToolResultMessages(messages);
  expect(pruned).not.toBe(messages);
  const prunedOld = asResult(pruned[0]);
  const text = (prunedOld.content[0] as { text: string }).text;
  expect(text.startsWith("x".repeat(100))).toBe(true);
  expect(text).toContain("[middle pruned:");
  expect(text.endsWith("x".repeat(TOOL_RESULT_PRUNE_TAIL_CHARS))).toBe(true);
  expect(text.length).toBeLessThan(BIG.length);
  expect(text.length).toBeGreaterThan(TOOL_RESULT_PRUNE_HEAD_CHARS);
  // The head is the genuine prefix, not a summary.
  expect(text.slice(0, 200)).toBe(BIG.slice(0, 200));
  // Recent results stay byte-identical.
  for (let index = 2; index < pruned.length; index += 1) {
    expect(asResult(pruned[index]).content).toBe(asResult(messages[index]).content);
  }
  // Structural fields survive untouched.
  expect(prunedOld.role).toBe("toolResult");
  expect(prunedOld.toolCallId).toBe("old");
  expect(prunedOld.isError).toBe(false);
});

it("preserves non-text blocks in pruned results", () => {
  const imageBlock = { type: "image", data: "base64", mimeType: "image/png" };
  const mixed = {
    role: "toolResult",
    toolCallId: "img",
    toolName: "Read",
    content: [{ type: "text", text: BIG }, imageBlock],
    isError: false,
    timestamp: 1,
  } as unknown as AgentMessage;
  const messages = [
    mixed,
    ...Array.from({ length: TOOL_RESULT_PRUNE_KEEP_LAST }, (_, index) =>
      toolResult(`recent-${index}`, SMALL),
    ),
  ];
  const pruned = pruneToolResultMessages(messages);
  const blocks = asResult(pruned[0]).content;
  expect(blocks).toHaveLength(2);
  expect(blocks[1]).toBe(imageBlock);
});

it("returns the same reference when old results are all small", () => {
  const messages = Array.from({ length: TOOL_RESULT_PRUNE_KEEP_LAST + 3 }, (_, index) =>
    toolResult(`call-${index}`, SMALL),
  );
  expect(pruneToolResultMessages(messages)).toBe(messages);
});
