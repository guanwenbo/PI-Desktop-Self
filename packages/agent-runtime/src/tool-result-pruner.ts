/**
 * Model-free tool-result pruning, modeled on dsh's
 * compaction-tool-result-pruner (and Codex's microcompact).
 *
 * Oversized older tool results dominate long sessions. Before paying for a
 * model summarization pass, this projection replaces the middle of large
 * tool-result text blocks with a bounded head, a short marker, and a bounded
 * tail. It never mutates the transcript or `agent.state.messages`: pruning
 * only shapes the request projection, and the full result stays in the
 * journal for replay and inspection.
 *
 * The prune is structural only — tool call pairing, message order, roles,
 * and non-text blocks are preserved, so the provider contract (every call
 * keeps exactly one result) is untouched.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Newest tool results always kept verbatim, regardless of size. */
export const TOOL_RESULT_PRUNE_KEEP_LAST = 4;
/** Results smaller than this are never touched. */
export const TOOL_RESULT_PRUNE_MIN_CHARS = 2_000;
/** Characters kept from the start of a pruned text block. */
export const TOOL_RESULT_PRUNE_HEAD_CHARS = 1_000;
/** Characters kept from the end of a pruned text block. */
export const TOOL_RESULT_PRUNE_TAIL_CHARS = 500;
/** Share of the hard budget that triggers the model-free prune pass. */
export const TOOL_RESULT_PRUNE_TRIGGER_RATIO = 0.6;

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function pruneText(text: string): string {
  if (text.length <= TOOL_RESULT_PRUNE_MIN_CHARS) return text;
  const head = text.slice(0, TOOL_RESULT_PRUNE_HEAD_CHARS);
  const tail = text.slice(-TOOL_RESULT_PRUNE_TAIL_CHARS);
  const omitted = text.length - TOOL_RESULT_PRUNE_HEAD_CHARS - TOOL_RESULT_PRUNE_TAIL_CHARS;
  return (
    `${head}\n[middle pruned: ${omitted} chars omitted — the full result was ` +
    `returned earlier; call the tool again if you need it]\n${tail}`
  );
}

function pruneContent(content: unknown): { content: unknown; changed: boolean } {
  if (!Array.isArray(content)) return { content, changed: false };
  let changed = false;
  const next = content.map((block) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return block;
    const pruned = pruneText(block.text);
    if (pruned === block.text) return block;
    changed = true;
    return { ...block, text: pruned };
  });
  return changed ? { content: next, changed } : { content, changed: false };
}

/**
 * Return the messages with old, oversized tool-result text pruned, or the
 * same array reference when nothing qualifies. The last
 * {@link TOOL_RESULT_PRUNE_KEEP_LAST} tool results always pass through.
 */
export function pruneToolResultMessages(
  messages: readonly AgentMessage[],
): AgentMessage[] {
  const toolResultIndexes: number[] = [];
  messages.forEach((message, index) => {
    if ((message as { role?: unknown }).role === "toolResult") toolResultIndexes.push(index);
  });
  const pruneBefore =
    toolResultIndexes.length > TOOL_RESULT_PRUNE_KEEP_LAST
      ? toolResultIndexes[toolResultIndexes.length - TOOL_RESULT_PRUNE_KEEP_LAST]
      : -1;
  if (pruneBefore < 0) return messages as AgentMessage[];

  let changed = false;
  const next = messages.map((message, index) => {
    if (index >= pruneBefore || (message as { role?: unknown }).role !== "toolResult") {
      return message;
    }
    const pruned = pruneContent((message as { content?: unknown }).content);
    if (!pruned.changed) return message;
    changed = true;
    return { ...message, content: pruned.content } as AgentMessage;
  });
  return changed ? next : (messages as AgentMessage[]);
}
