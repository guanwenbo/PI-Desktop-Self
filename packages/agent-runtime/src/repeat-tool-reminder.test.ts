import { expect, it } from "vitest";
import { REPEAT_REMINDER_THRESHOLDS, RepeatToolReminder } from "./repeat-tool-reminder.js";

it("reminds only at the configured streak thresholds", () => {
  const reminder = new RepeatToolReminder();
  const observed = Array.from({ length: 9 }, () => reminder.observe("Read", { path: "/a" }));
  const firedAt = observed.map((text, index) => (text ? index + 1 : 0)).filter(Boolean);
  expect(firedAt).toEqual([...REPEAT_REMINDER_THRESHOLDS]);
});

it("treats argument objects as equal regardless of property order", () => {
  const reminder = new RepeatToolReminder();
  expect(reminder.observe("Grep", { pattern: "x", path: "/a", include: ["*.ts"] })).toBeUndefined();
  expect(reminder.observe("Grep", { path: "/a", pattern: "x", include: ["*.ts"] })).toBeUndefined();
  const third = reminder.observe("Grep", { include: ["*.ts"], path: "/a", pattern: "x" });
  expect(third).toContain("identical arguments");
});

it("resets the streak when a different call intervenes", () => {
  const reminder = new RepeatToolReminder();
  reminder.observe("Read", { path: "/a" });
  reminder.observe("Read", { path: "/a" });
  reminder.observe("Read", { path: "/b" });
  reminder.observe("Read", { path: "/a" });
  reminder.observe("Read", { path: "/a" });
  expect(reminder.observe("Read", { path: "/a" })).toContain("identical arguments");
});

it("counts different tools separately even with identical arguments", () => {
  const reminder = new RepeatToolReminder();
  reminder.observe("Read", { path: "/a" });
  reminder.observe("Read", { path: "/a" });
  reminder.observe("Write", { path: "/a" });
  reminder.observe("Read", { path: "/a" });
  // The Write call broke the Read streak: this is Read's first of a new run.
  expect(reminder.observe("Read", { path: "/a" })).toBeUndefined();
});

it("reset clears counters so a new user message starts fresh", () => {
  const reminder = new RepeatToolReminder();
  reminder.observe("Read", { path: "/a" });
  reminder.observe("Read", { path: "/a" });
  reminder.reset();
  expect(reminder.observe("Read", { path: "/a" })).toBeUndefined();
  expect(reminder.observe("Read", { path: "/a" })).toBeUndefined();
  expect(reminder.observe("Read", { path: "/a" })).toContain("identical arguments");
});

it("handles non-object and cyclic arguments without throwing", () => {
  const reminder = new RepeatToolReminder();
  expect(reminder.observe("Bash", "ls")).toBeUndefined();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(reminder.observe("Bash", cyclic)).toBeUndefined();
  expect(reminder.observe("Bash", cyclic)).toBeUndefined();
});
