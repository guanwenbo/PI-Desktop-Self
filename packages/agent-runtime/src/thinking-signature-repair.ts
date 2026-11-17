import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ClassifiedAgentError } from "./agent-errors.js";

/**
 * Anthropic (and Bedrock-backed gateways) bind a thinking signature to the
 * conversation prefix it was produced under. When the replayed history no
 * longer matches that prefix the provider answers 400 with, for example,
 * "***.content.0: Invalid `signature` in `thinking` block. The block is bound
 * to a different conversation." The signed block stays in the stored history,
 * so without a repair every later turn of the session fails the same way.
 */
const THINKING_SIGNATURE_REJECTION =
  /invalid\s+`?signature`?\s+in\s+`?(?:redacted_)?thinking`?\s+block/i;

/** A provider 400 that rejects a replayed thinking signature. */
export function isThinkingSignatureRejection(error: ClassifiedAgentError): boolean {
  if (error.code !== "PROVIDER_ERROR") return false;
  const providerStatus = error.details?.providerStatus;
  if (providerStatus !== undefined && providerStatus !== 400) return false;
  return THINKING_SIGNATURE_REJECTION.test(error.message);
}

type PayloadMessage = { role?: unknown; content?: unknown };

function isThinkingBlock(block: unknown): boolean {
  if (typeof block !== "object" || block === null) return false;
  const type = (block as { type?: unknown }).type;
  return type === "thinking" || type === "redacted_thinking";
}

/**
 * Drop every thinking block from an Anthropic Messages payload, including the
 * blocks of the turn in flight. The gateway also rejects a signature produced
 * seconds earlier in the same turn, so keeping any signed block leaves the
 * repaired request open to the same rejection. The gateway accepts an
 * assistant tool call without a leading thinking block.
 *
 * Text, tool calls and tool results stay, so the model keeps the visible
 * history; this is the same request pi-ai builds when the session switches to
 * another model, where signed blocks of the previous model are dropped. An
 * assistant message left empty is removed, as pi-ai does for an empty message.
 * Payloads of other API styles have no such blocks and pass through unchanged.
 */
export function stripThinking(payload: unknown): {
  payload: unknown;
  removed: number;
} {
  if (typeof payload !== "object" || payload === null) return { payload, removed: 0 };
  const { messages } = payload as { messages?: unknown };
  if (!Array.isArray(messages)) return { payload, removed: 0 };

  let removed = 0;
  const next: unknown[] = [];
  messages.forEach((message: PayloadMessage) => {
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
      next.push(message);
      return;
    }
    const kept = message.content.filter((block) => !isThinkingBlock(block));
    removed += message.content.length - kept.length;
    if (kept.length === message.content.length) next.push(message);
    else if (kept.length > 0) next.push({ ...message, content: kept });
  });
  if (removed === 0) return { payload, removed };
  return { payload: { ...(payload as Record<string, unknown>), messages: next }, removed };
}

/**
 * Request options that send the history without thinking blocks. Any caller
 * `onPayload` hook still runs first. `onStripped` fires for a payload that
 * actually lost blocks.
 */
export function withoutThinking(
  options: SimpleStreamOptions,
  onStripped?: (removed: number) => void,
): SimpleStreamOptions {
  return {
    ...options,
    onPayload: async (payload, model) => {
      const rewritten = (await options.onPayload?.(payload, model)) ?? payload;
      const stripped = stripThinking(rewritten);
      if (stripped.removed > 0) onStripped?.(stripped.removed);
      return stripped.payload;
    },
  };
}
