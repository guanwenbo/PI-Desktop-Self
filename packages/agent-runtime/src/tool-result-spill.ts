/**
 * Runtime-side spill for oversized tool results, modeled on dsh's
 * spill-store and mirroring host-core's `truncate_with_spill` marker
 * ("Full output saved to <path> — Grep it, or Read it with offset/limit").
 *
 * host-core already spills Bash/Read/Grep/Glob output at its own budgets.
 * Plugin and MCP tool results never pass through that path — an oversized
 * `plugin_*` result lands in the model context whole. When a session
 * scratch directory is provisioned, this module persists the full text
 * there and hands the model a bounded head/tail plus the locator, so the
 * full result stays retrievable with the ordinary Read/Grep tools.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Results at or below this size are returned untouched. */
export const RUNTIME_SPILL_MIN_CHARS = 64_000;
/** Characters kept from the start of a spilled result. */
export const RUNTIME_SPILL_HEAD_CHARS = 4_000;
/** Characters kept from the end of a spilled result. */
export const RUNTIME_SPILL_TAIL_CHARS = 1_000;

function pathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

export type SpillToolResultOptions = {
  /** Session scratch root; spilling is disabled when it is not provisioned. */
  scratchDir?: string;
  toolName: string;
  toolCallId: string;
  text: string;
};

/**
 * Persist oversized tool-result text to the session scratch directory and
 * return a bounded preview with the retrieval marker, or the original text
 * when spilling does not apply or the write fails (failure never alters the
 * result the model would otherwise see).
 */
export function spillToolResultText(options: SpillToolResultOptions): string {
  const { scratchDir, toolName, toolCallId, text } = options;
  if (!scratchDir || text.length <= RUNTIME_SPILL_MIN_CHARS) return text;
  try {
    const dir = join(scratchDir, "tool-results");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${pathSegment(toolName)}-${pathSegment(toolCallId)}.txt`);
    writeFileSync(target, text, "utf8");
    const head = text.slice(0, RUNTIME_SPILL_HEAD_CHARS);
    const tail = text.slice(-RUNTIME_SPILL_TAIL_CHARS);
    return (
      `${head}\n[full output saved to ${target} (${text.length} chars) — ` +
      `Grep it, or Read it with offset/limit]\n${tail}`
    );
  } catch {
    return text;
  }
}
