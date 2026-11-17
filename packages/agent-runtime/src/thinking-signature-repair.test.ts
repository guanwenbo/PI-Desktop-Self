import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { classifyProviderError, createProviderRetryStream } from "./provider-retry.js";
import {
  isThinkingSignatureRejection,
  stripThinking,
  withoutThinking,
} from "./thinking-signature-repair.js";

/** The rejection a Bedrock-backed Anthropic gateway returns for a stale signature. */
const SIGNATURE_REJECTION =
  '400 {"error":{"cause":"{\\"error\\":{\\"message\\":\\"bad response status code 400, ' +
  "message: InvokeModelWithResponseStream: operation error Bedrock Runtime: " +
  "InvokeModelWithResponseStream, https response error StatusCode: 400, " +
  "ValidationException: ***.***.content.0: Invalid `signature` in `thinking` block. " +
  'The block is bound to a different conversation."}}"}}';

const model = {
  id: "claude-opus",
  api: "anthropic-messages",
  provider: "anthropic",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8_000,
  baseUrl: "https://gateway.invalid",
} as any;
const context = { messages: [], tools: [] };

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-opus",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: SIGNATURE_REJECTION,
    timestamp: 0,
    ...overrides,
  };
}

function failedStream(overrides: Partial<AssistantMessage> = {}) {
  const stream = createAssistantMessageEventStream();
  const error = assistantMessage(overrides);
  queueMicrotask(() => {
    stream.push({ type: "error", reason: "error", error });
    stream.end(error);
  });
  return stream;
}

function successfulStream() {
  const stream = createAssistantMessageEventStream();
  const message = assistantMessage({
    content: [{ type: "text", text: "recovered" }],
    stopReason: "stop",
    errorMessage: undefined,
  });
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

const thinking = (signature: string) => ({ type: "thinking", thinking: "plan", signature });

/** Two finished turns, then the user's new prompt. */
function historyPayload() {
  return {
    model: "claude-opus",
    max_tokens: 4096,
    messages: [
      { role: "user", content: "first question" },
      { role: "assistant", content: [thinking("sig-1"), { type: "text", text: "first answer" }] },
      { role: "user", content: "second question" },
      {
        role: "assistant",
        content: [
          thinking("sig-2"),
          { type: "tool_use", id: "t1", name: "Read", input: {} },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      {
        role: "assistant",
        content: [{ type: "redacted_thinking", data: "opaque" }, { type: "text", text: "second answer" }],
      },
      { role: "user", content: "third question" },
    ],
  };
}

describe("isThinkingSignatureRejection", () => {
  it("recognises the gateway's stale-signature 400", () => {
    const error = classifyProviderError(assistantMessage());
    expect(error.code).toBe("PROVIDER_ERROR");
    expect(isThinkingSignatureRejection(error)).toBe(true);
  });

  it("leaves other bad requests alone", () => {
    const other = classifyProviderError(
      assistantMessage({ errorMessage: "400 messages.1.content.0: Invalid `tool_use` block" }),
    );
    expect(isThinkingSignatureRejection(other)).toBe(false);
  });
});

describe("stripThinking", () => {
  it("drops thinking and redacted thinking and keeps everything else", () => {
    const { payload, removed } = stripThinking(historyPayload());
    expect(removed).toBe(3);
    expect(payload).toEqual({
      model: "claude-opus",
      max_tokens: 4096,
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: [{ type: "text", text: "first answer" }] },
        { role: "user", content: "second question" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        { role: "assistant", content: [{ type: "text", text: "second answer" }] },
        { role: "user", content: "third question" },
      ],
    });
  });

  it("also drops the thinking of the turn in flight, across tool results", () => {
    // The gateway rejects even a signature written seconds earlier in the same
    // turn, so a repaired request must not carry any signed block.
    const payload = {
      messages: [
        { role: "user", content: "old" },
        { role: "assistant", content: [thinking("old"), { type: "text", text: "done" }] },
        { role: "user", content: "run it" },
        {
          role: "assistant",
          content: [thinking("live"), { type: "tool_use", id: "t1", name: "Bash", input: {} }],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ],
    };
    const result = stripThinking(payload);
    expect(result.removed).toBe(2);
    const messages = (result.payload as typeof payload).messages;
    expect(messages[1]!.content).toEqual([{ type: "text", text: "done" }]);
    // The tool call keeps its id so the following tool result still pairs with it.
    expect(messages[3]!.content).toEqual([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]);
    expect(messages[4]).toBe(payload.messages[4]);
  });

  it("removes an assistant message that only held thinking", () => {
    const { payload } = stripThinking({
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: [thinking("only")] },
        { role: "user", content: "b" },
      ],
    });
    expect((payload as { messages: unknown[] }).messages).toEqual([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
  });

  it("returns the same payload when nothing was dropped", () => {
    const plain = { messages: [{ role: "user", content: "hi" }] };
    expect(stripThinking(plain)).toEqual({ payload: plain, removed: 0 });
    expect(stripThinking(plain).payload).toBe(plain);
    const other = { input: [{ role: "user", content: "hi" }] };
    expect(stripThinking(other).payload).toBe(other);
    expect(stripThinking(undefined).payload).toBeUndefined();
  });

  it("runs the caller's onPayload hook before stripping", async () => {
    const seen = vi.fn();
    const options = withoutThinking(
      { onPayload: async (body) => ({ ...(body as object), hooked: true }) },
      seen,
    );
    const result = (await options.onPayload!(historyPayload(), model)) as Record<string, unknown>;
    expect(result.hooked).toBe(true);
    expect(seen).toHaveBeenCalledWith(3);
  });
});

describe("signature rejection repair in the provider retry stream", () => {
  async function run(
    attempts: Array<() => ReturnType<typeof failedStream>>,
    controller: Record<string, unknown> = {},
  ) {
    const payloads: unknown[] = [];
    const claim = vi.fn(() => undefined);
    const sleep = vi.fn(async () => undefined);
    const onThinkingRepair = vi.fn();
    let call = 0;
    const stream = createProviderRetryStream(
      model,
      context,
      {},
      (options) => {
        const attempt = attempts[Math.min(call, attempts.length - 1)]!;
        call += 1;
        const attemptOptions = options;
        payloads.push(
          (async () => attemptOptions.onPayload?.(historyPayload(), model) ?? historyPayload())(),
        );
        return attempt();
      },
      { claim, sleep, onThinkingRepair, headers: () => undefined, ...controller },
    );
    for await (const _event of stream) {
      // Drain the stream.
    }
    return {
      result: await stream.result(),
      calls: call,
      sent: await Promise.all(payloads),
      claim,
      sleep,
      onThinkingRepair,
    };
  }

  it("resends once without thinking and recovers the turn", async () => {
    const run1 = await run([() => failedStream(), () => successfulStream()]);
    expect(run1.calls).toBe(2);
    expect(run1.result.stopReason).toBe("stop");
    // The shared transient budget and its backoff are never touched.
    expect(run1.claim).not.toHaveBeenCalled();
    expect(run1.sleep).not.toHaveBeenCalled();
    // First request replays the signed history; the repair drops it.
    const [first, second] = run1.sent as Array<ReturnType<typeof historyPayload>>;
    expect(JSON.stringify(first)).toContain("sig-1");
    expect(JSON.stringify(second)).not.toContain("thinking");
    expect(run1.onThinkingRepair).toHaveBeenCalledTimes(1);
    expect(run1.onThinkingRepair).toHaveBeenCalledWith(
      expect.objectContaining({ removed: 3 }),
    );
  });

  it("surfaces the rejection when the repaired request fails the same way", async () => {
    const outcome = await run([() => failedStream()]);
    expect(outcome.calls).toBe(2);
    expect(outcome.result.stopReason).toBe("error");
    expect(outcome.result.errorMessage).toContain("Invalid `signature`");
  });

  it("does not repair when the session already sends the history repaired", async () => {
    const outcome = await run([() => failedStream()], { thinkingRepaired: () => true });
    expect(outcome.calls).toBe(1);
    expect(outcome.onThinkingRepair).not.toHaveBeenCalled();
  });

  it("does not touch unrelated bad requests", async () => {
    const outcome = await run([
      () => failedStream({ errorMessage: "400 messages.1.content.0: Invalid `tool_use` block" }),
    ]);
    expect(outcome.calls).toBe(1);
    expect(outcome.onThinkingRepair).not.toHaveBeenCalled();
  });
});
