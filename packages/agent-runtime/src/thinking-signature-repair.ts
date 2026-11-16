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
 * A user message that opens a turn. Tool results are also sent as `user`
 * messages, but they continue the turn the assistant is still working on.
 */
function opensTurn(message: PayloadMessage): boolean {
  if (message.role !== "user") return false;
  const { content } = message;
  if (!Array.isArray(content)) return true;
  return !content.every(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "tool_result",
  );
}

/**
 * Drop the thinking blocks of every completed turn from an Anthropic Messages
 * payload. The turn in flight keeps its blocks: with thinking enabled the
 * provider requires an assistant message that carries a tool call to start
 * with its own thinking block.
 *
 * Text, tool calls and tool results stay, so the model keeps the visible
 * history; this is the same request pi-ai builds when the session switches to
 * another model, where signed blocks of the previous model are dropped. An
 * assistant message left empty is removed, as pi-ai does for an empty message.
 * Payloads of other API styles have no such blocks and pass through unchanged.
 */
export function stripCompletedTurnThinking(payload: unknown): {
  payload: unknown;
  removed: number;
} {
  if (typeof payload !== "object" || payload === null) return { payload, removed: 0 };
  const { messages } = payload as { messages?: unknown };
  if (!Array.isArray(messages)) return { payload, removed: 0 };

  let currentTurnStart = 0;
  messages.forEach((message: PayloadMessage, index) => {
    if (message && opensTurn(message)) currentTurnStart = index;
  });

  let removed = 0;
  const next: unknown[] = [];
  messages.forEach((message: PayloadMessage, index) => {
    if (
      index >= currentTurnStart ||
      !message ||
      message.role !== "assistant" ||
      !Array.isArray(message.content)
    ) {
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
 * Request options that send the history without the thinking blocks of
 * completed turns. Any caller `onPayload` hook still runs first. `onStripped`
 * fires for a payload that actually lost blocks.
 */
export function withoutCompletedTurnThinking(
  options: SimpleStreamOptions,
  onStripped?: (removed: number) => void,
): SimpleStreamOptions {
  return {
    ...options,
    onPayload: async (payload, model) => {
      const rewritten = (await options.onPayload?.(payload, model)) ?? payload;
      const stripped = stripCompletedTurnThinking(rewritten);
      if (stripped.removed > 0) onStripped?.(stripped.removed);
      return stripped.payload;
    },
  };
}
