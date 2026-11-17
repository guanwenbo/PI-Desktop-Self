import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  RUNTIME_SPILL_HEAD_CHARS,
  RUNTIME_SPILL_MIN_CHARS,
  RUNTIME_SPILL_TAIL_CHARS,
  spillToolResultText,
} from "./tool-result-spill.js";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-spill-test-"));
  cleanups.push(dir);
  return dir;
}

const BIG = "0123456789".repeat(RUNTIME_SPILL_MIN_CHARS / 10 + 100);

it("returns small results untouched", () => {
  expect(spillToolResultText({ scratchDir: scratch(), toolName: "plugin_x_y", toolCallId: "c1", text: "ok" })).toBe("ok");
});

it("returns oversized results untouched when no scratch dir is provisioned", () => {
  expect(spillToolResultText({ toolName: "plugin_x_y", toolCallId: "c1", text: BIG })).toBe(BIG);
});

it("spills oversized results to scratch and returns head, marker, and tail", () => {
  const dir = scratch();
  const preview = spillToolResultText({ scratchDir: dir, toolName: "plugin_x_y", toolCallId: "call 1|item", text: BIG });
  expect(preview).not.toBe(BIG);
  expect(preview.length).toBeLessThan(BIG.length);
  expect(preview.slice(0, RUNTIME_SPILL_HEAD_CHARS)).toBe(BIG.slice(0, RUNTIME_SPILL_HEAD_CHARS));
  expect(preview.endsWith(BIG.slice(-RUNTIME_SPILL_TAIL_CHARS))).toBe(true);
  const marker = /\[full output saved to (.+?) \(\d+ chars\) — Grep it, or Read it with offset\/limit\]/;
  const match = preview.match(marker);
  expect(match).not.toBeNull();
  const target = match![1];
  expect(target.startsWith(dir)).toBe(true);
  expect(readFileSync(target, "utf8")).toBe(BIG);
});

it("keeps spilling independent per tool call id", () => {
  const dir = scratch();
  const first = spillToolResultText({ scratchDir: dir, toolName: "plugin_a_b", toolCallId: "c1", text: BIG });
  const second = spillToolResultText({ scratchDir: dir, toolName: "plugin_a_b", toolCallId: "c2", text: `${BIG}2` });
  expect(first).not.toEqual(second);
});

it("never throws on an unwritable scratch dir", () => {
  const text = spillToolResultText({
    scratchDir: "/nonexistent/\0invalid",
    toolName: "plugin_x_y",
    toolCallId: "c1",
    text: BIG,
  });
  expect(text).toBe(BIG);
});
