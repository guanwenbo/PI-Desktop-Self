/** Shared public types grouped by the owning application domain. */
import type { AppError } from "../errors.js";
import type { PlanExecution, PlanningStateEvent } from "./plans.js";
import type { ContextCompactionFallback, ContextCompactionMark, ContextCompactionReason } from "./sessions.js";
import type { AgentStatus } from "./sessions.js";
import type { MessageUsage, ToolTokenUsage, UiMessage, VoiceOrigin } from "./messages.js";
import type { PermissionDecision, Risk } from "./permissions.js";
import type { ThinkingLevel } from "./models.js";
import type { RacpPermissionMode } from "../racp.js";

export type AgentPromptRequest = {
  sessionId: string;
  content: string;
  /** Host-owned collaboration delivery; its durable record supplies the input. */
  sessionMessageId?: string;
  /** Attachments are resolved by Electron main and never trusted by the sidecar. */
  attachments?: AgentPromptAttachment[];
  /**
   * When set, truncate the durable transcript to this many leading messages
   * before appending the new user turn. Used by regenerate / edit-resend so
   * the branch replaces the tail instead of stacking a duplicate turn.
   *
   * Prefer `truncateFromMessageId`: a count is only correct when the renderer
   * holds the entire history, and it is kept for older callers.
   */
  truncateBefore?: number;
  /**
   * Identity of the first message to drop. The host resolves it against its own
   * transcript, so a bounded window or a deduplicated renderer array cannot
   * shift the cut. Takes precedence over `truncateBefore`.
   */
  truncateFromMessageId?: string;
  /**
   * Renderer-chosen id for the new user message (D288). The renderer inserts
   * the row under this id before the host round trip, and the host persists
   * and echoes the durable row under the same id so the echo replaces the
   * optimistic row in place instead of adding a second one. Must be a UUID
   * that is not already in the session; anything else is ignored and the host
   * mints its own.
   */
  messageId?: string;
  /** Main-trusted source metadata for a Live Voice work admission. */
  voiceOrigin?: VoiceOrigin;
  /**
   * Renderer snapshot of the chat session visible when the prompt was sent.
   * Electron installs it before asynchronous turn setup for notification
   * suppression; missing, null, or mismatched values fail safe.
   */
  viewingSessionId?: string | null;
  /**
   * Per-turn permission ceiling override (spec §7.3): the effective mode the
   * remote layer computed for this specific turn, which the runtime must apply
   * for tool decisions instead of the session's stored mode. Absent means the
   * session's stored mode is used. Accepted only when the requested mode is
   * narrower than or equal to the session's mode; a wider request is refused
   * before the turn starts. The bridge forwards this end-to-end so the
   * host-core scoping (still pending, R1 leftover) can enforce it turn-locally
   * once it lands.
   */
  permissionMode?: RacpPermissionMode;
};

export type AgentPromptAttachment = {
  path: string;
  name: string;
  kind: "image" | "file";
  mimeType?: string;
  size?: number;
  /**
   * The `@path` text this attachment occupies inline in `content`. Electron main
   * fills it for an attachment the user's draft placed between words, so the
   * runtime keeps the image block at that position instead of trailing the
   * prompt text. Absent for older callers and formatted messages.
   */
  inlinePath?: string;
};

export type AgentSteerRequest = Pick<
  AgentPromptRequest,
  "sessionId" | "content" | "attachments" | "messageId" | "voiceOrigin"
> & {
  expectedTurnId: string;
};

export type AgentPromptResponse = {
  accepted: boolean;
  turnId: string;
};

export type AgentExecuteApprovedPlanRequest = {
  sessionId: string;
  turnId: string;
  execution: PlanExecution;
};

export type AgentExecuteApprovedPlanResponse = {
  accepted: boolean;
  turnId: string;
};

export type AgentAbortRequest = {
  sessionId: string;
  turnId?: string;
};

/** Request a stop at the next completed agent turn boundary. */
export type AgentStopRequest = {
  sessionId: string;
  turnId?: string;
};

export type AgentStopResponse = {
  requested: boolean;
};

/** One entry of the Host-owned turn queue as the renderer mirrors it (D386). */
export type QueuedTurnSummary = {
  id: string;
  sessionId: string;
  content: string;
  sessionMessageId?: string;
  userMessageId?: string;
  voiceOrigin?: VoiceOrigin;
  attachments?: AgentPromptAttachment[];
  position: number;
  /** Set only for promoted entries; entries arrive in delivery order. */
  priority?: number;
  createdAt: string;
};

export type AgentQueuePushRequest = {
  sessionId: string;
  content: string;
  sessionMessageId?: string;
  userMessageId?: string;
  voiceOrigin?: VoiceOrigin;
  attachments?: AgentPromptAttachment[];
  idempotencyKey?: string;
};

export type AgentQueueChangedEvent = {
  sessionId: string;
  entries: QueuedTurnSummary[];
};

export type AgentCompactRequest = {
  sessionId: string;
};

export type AgentCompactResponse = {
  accepted: boolean;
};

export type ToolPermissionRequest = {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  argsPreview: unknown;
  risk: Risk;
  reason: string;
  /** Subagent that asked, when the call came from a delegate (ADR 0062). */
  agentName?: string;
  /** `Task` call that spawned the asking delegate. */
  parentToolCallId?: string;
  /** Immediate tool parent when this request came from nested execution. */
  nestedParentToolCallId?: string;
};

export type ToolPermissionResolution = {
  requestId: string;
  decision: PermissionDecision;
};

/**
 * What choosing one answer actually does, shown beside the answer before the
 * choice is made (borrowed from DeepSeek Harness's consequence-aware ask panel).
 *
 * Every field is optional: a model that only knows the one-line summary writes
 * that and the card renders the rest as absent rather than inventing detail.
 * Applies to the option-level preview only, never to the model-facing answer.
 */
export type AskToolImpact = {
  /** One line: what choosing this does. */
  summary?: string;
  /** Concrete edits or actions the choice causes. */
  changes?: string[];
  /** Files or paths the choice touches. */
  files?: string[];
  /** Effect on behavior that already works today. */
  effects?: string[];
  /** Risk of taking this path. */
  risk?: string;
  /** Rough cost in effort, tokens, or rounds. */
  cost?: string;
  /** False when the choice is hard to undo, which is when the answer matters most. */
  reversible?: boolean;
};

/** Caps that keep a model-written impact readable inside the composer card. */
const MAX_ASK_TOOL_IMPACT_SUMMARY_CHARS = 400;
const MAX_ASK_TOOL_IMPACT_ITEM_CHARS = 200;
const MAX_ASK_TOOL_IMPACT_ITEMS = 6;

/** A selectable asktool answer: a plain label or a label with supporting copy. */
export type AskToolOption =
  | string
  | {
      label: string;
      description?: string;
      impact?: AskToolImpact;
    };

/** Maximum length of one asktool prompt, counted in Unicode code points. */
export const MAX_ASK_TOOL_QUESTION_CHARS = 300;

export function isAskToolQuestionWithinLimit(question: string): boolean {
  let characterCount = 0;
  for (const _character of question) {
    if (characterCount >= MAX_ASK_TOOL_QUESTION_CHARS) return false;
    characterCount += 1;
  }
  return true;
}

/** Trim one impact line and bound it, so a runaway value cannot unbalance the card. */
function clipAskToolImpactText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1).trimEnd()}…` : trimmed;
}

/** Trim a list of impact lines, dropping blanks and bounding both count and width. */
function clipAskToolImpactList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const entry of value) {
    const item = clipAskToolImpactText(entry, MAX_ASK_TOOL_IMPACT_ITEM_CHARS);
    if (item) items.push(item);
    if (items.length >= MAX_ASK_TOOL_IMPACT_ITEMS) break;
  }
  return items.length > 0 ? items : undefined;
}

/**
 * Normalize a model-provided impact object, dropping empty fields so the card
 * only renders sections that carry something the user can read.
 */
export function normalizeAskToolImpact(value: unknown): AskToolImpact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const impact: AskToolImpact = {};
  const summary = clipAskToolImpactText(source.summary, MAX_ASK_TOOL_IMPACT_SUMMARY_CHARS);
  if (summary) impact.summary = summary;
  const changes = clipAskToolImpactList(source.changes);
  if (changes) impact.changes = changes;
  const files = clipAskToolImpactList(source.files);
  if (files) impact.files = files;
  const effects = clipAskToolImpactList(source.effects);
  if (effects) impact.effects = effects;
  const risk = clipAskToolImpactText(source.risk, MAX_ASK_TOOL_IMPACT_ITEM_CHARS);
  if (risk) impact.risk = risk;
  const cost = clipAskToolImpactText(source.cost, MAX_ASK_TOOL_IMPACT_ITEM_CHARS);
  if (cost) impact.cost = cost;
  if (typeof source.reversible === "boolean") impact.reversible = source.reversible;
  return Object.keys(impact).length > 0 ? impact : undefined;
}

/** Normalize a model-provided asktool option and discard malformed/empty values. */
export function normalizeAskToolOption(value: unknown): AskToolOption | undefined {
  if (typeof value === "string") {
    const label = value.trim();
    return label || undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const option = value as Record<string, unknown>;
  const label = typeof option.label === "string" ? option.label.trim() : "";
  if (!label) return undefined;
  const description =
    typeof option.description === "string" ? option.description.trim() : "";
  const impact = normalizeAskToolImpact(option.impact);
  return {
    label,
    ...(description ? { description } : {}),
    ...(impact ? { impact } : {}),
  };
}

export function askToolOptionLabel(option: AskToolOption): string {
  return typeof option === "string" ? option : option.label;
}

export function askToolOptionDescription(
  option: AskToolOption,
): string | undefined {
  if (typeof option === "string") return undefined;
  const description = option.description?.trim();
  return description || undefined;
}

/** The consequence preview of one answer, when the model supplied one. */
export function askToolOptionImpact(
  option: AskToolOption,
): AskToolImpact | undefined {
  if (typeof option === "string") return undefined;
  return option.impact;
}

/** A model-created question shown in the inline asktool card. */
export type AskToolQuestion = {
  question: string;
  options: AskToolOption[];
  multiSelect?: boolean;
};

export type AskToolRequest = {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  questions: AskToolQuestion[];
};

/**
 * Every interactive request one session is currently waiting on. Host state,
 * not connection state: a renderer that reloaded reads this instead of holding
 * a card that no longer exists, and it stays empty for a session with nothing
 * pending.
 */
export type PendingInteractiveRequests = {
  asks: AskToolRequest[];
  permissions: ToolPermissionRequest[];
};

/**
 * What the user decided by declining the whole prompt.
 *
 * Declining used to be a silent "no answer", which left the agent to guess
 * whether the question was unwanted or the user wanted to answer later. A
 * disposition makes the decision explicit: `proceed` hands the call back to
 * the agent, `halt` ends the turn so no further model request is issued.
 */
export type AskToolDisposition = "proceed" | "halt";

/**
 * One resolution of a pending asktool request.
 *
 * `null` in `answers` means the user skipped that question or declined the
 * whole prompt. `disposition` is present only when the user declined, and an
 * absent value keeps the pre-existing behaviour (the agent carries on).
 */
export type AskToolResolution = {
  requestId: string;
  sessionId: string;
  answers: Array<string[] | null>;
  disposition?: AskToolDisposition;
};

/** Stable model-facing serialization for one asktool result. */
export function formatAskToolOutput(
  questions: AskToolQuestion[],
  answers: Array<string[] | null>,
): string {
  return questions
    .map((question, index) => {
      const answer = answers[index]?.join("、") ?? "";
      return `${question.question}：${answer}`;
    })
    .join("\n---\n");
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messageIds: string[] }
  | { type: "turn_start" }
  | { type: "usage"; usage: MessageUsage }
  | { type: "turn_end"; subagentUsage?: MessageUsage }
  | { type: "message_start"; message: UiMessage }
  | {
      type: "message_update";
      message: UiMessage;
      deltaText?: string;
      deltaThinking?: string;
      /**
       * Append-only streaming frame. Growing `content` / `thinking` are omitted
       * from `message`; apply `deltaText` / `deltaThinking` onto the live row.
       * Snapshot replacements omit this field and still carry a full `message`.
       */
      stream?: "delta";
      resetText?: boolean;
      resetThinking?: boolean;
    }
  | { type: "message_end"; message: UiMessage; precedingAssistant?: UiMessage; replacesMessageId?: string }
  | { type: "user_message_persisted"; optimisticMessageId: string; message: UiMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; partialResult?: unknown }
  | {
      type: "tool_end";
      toolCallId: string;
      result: unknown;
      isError?: boolean;
      toolUsage?: ToolTokenUsage;
    }
  | ({ type: "planning_state" } & Omit<PlanningStateEvent, "sessionId">)
  | { type: "tool_permission_request"; request: ToolPermissionRequest }
  | { type: "asktool_request"; request: AskToolRequest }
  | {
      type: "compaction_start";
      reason: ContextCompactionReason;
    }
  | {
      type: "compaction_end";
      reason: ContextCompactionReason;
      ok: boolean;
      tokensBefore?: number;
      firstKeptMessageId?: string;
      willRetry: boolean;
      fallback?: ContextCompactionFallback;
      /** Present when a checkpoint was installed: it feeds the transcript row
       * and the context inspector. */
      mark?: ContextCompactionMark;
      error?: { code: string; message: string };
    }
  | { type: "error"; error: AppError }
  | { type: "status"; status: AgentStatus };

export type AgentEventEnvelope = {
  sessionId: string;
  turnId?: string;
  ts: number;
  event: AgentEvent;
  /**
   * Set on every event emitted from inside a subagent (ADR 0062): the `Task`
   * tool call that owns the delegate. Main tags persisted rows with it and
   * skips the turn-lifecycle handling that belongs to the parent alone.
   */
  parentToolCallId?: string;
  /** Immediate nested-tool parent; never identifies subagent ownership. */
  nestedParentToolCallId?: string;
  /** Definition name of the emitting subagent. */
  agentName?: string;
};

/** Explicit user cancellation; omitted IDs select this session's running delegates. */
export type AgentStopSubagentsRequest = {
  sessionId: string;
  delegationIds?: string[];
};

export type AgentStopSubagentsResponse = {
  pending: string[];
};
