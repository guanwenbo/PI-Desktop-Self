/**
 * Advisory loop-hygiene guard, modeled on dsh's repeat-tool-reminder.
 *
 * When the model repeats the exact same tool call — same tool, same
 * arguments regardless of property order — without any intervening call,
 * the wrapper appends a short reminder to that call's result. The reminder
 * only advises; it never blocks, delays, or alters the call itself, so
 * legitimate repetition (polling, retries with intent) keeps working.
 *
 * Counts reset when any different call intervenes and when a new user
 * message starts a turn (`reset`).
 */

/** Streak lengths at which a reminder fires. */
export const REPEAT_REMINDER_THRESHOLDS: readonly number[] = [3, 5, 8];

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export class RepeatToolReminder {
  private streakKey: string | undefined;
  private streakCount = 0;
  private readonly remindedCounts = new Set<number>();

  /** Clear all counters. Called when a new user message starts a turn. */
  reset(): void {
    this.streakKey = undefined;
    this.streakCount = 0;
    this.remindedCounts.clear();
  }

  /**
   * Record one tool call and return the reminder text to append to its
   * result, or undefined when the streak has not reached a threshold.
   */
  observe(toolName: string, args: unknown): string | undefined {
    let key: string;
    try {
      key = `${toolName}${stableStringify(args)}`;
    } catch {
      // Unstringifiable arguments cannot be compared; never remind on them.
      this.reset();
      return undefined;
    }
    if (key === this.streakKey) {
      this.streakCount += 1;
    } else {
      this.streakKey = key;
      this.streakCount = 1;
    }
    if (
      !REPEAT_REMINDER_THRESHOLDS.includes(this.streakCount) ||
      this.remindedCounts.has(this.streakCount)
    ) {
      return undefined;
    }
    this.remindedCounts.add(this.streakCount);
    return (
      `[loop-hygiene] You have called ${toolName} with identical arguments ` +
      `${this.streakCount} times in a row. Re-read the latest result: if it ` +
      `already answers the question, use it and move on; if it does not, change ` +
      `approach — different arguments, a different tool, or report the blocker — ` +
      `instead of repeating the same call.`
    );
  }
}
