# ADR 0312: Session-scoped Todo checklist

- Status: Accepted for implementation
- Date: 2026-09-29
- Related: Issue #1177

## Context

Multi-step Agent work needs a durable, ordered, session-scoped checklist that
survives restart and stays isolated from Plan/Goal contract negotiation and
delegated subagent calls, without making the renderer a second source of truth.

## Decision

`TodoWrite` is an Agent-only builtin tool whose arguments carry the complete
ordered checklist, validated by host-core, which owns persistence in SQLite
schema v21: `session_todo` stores the rows while `sessions.todo_revision` and
`sessions.todo_updated_at` order populated and empty snapshots, each write
replacing the rows and incrementing the revision in one transaction. The call is
authorized against the calling session and its running turn inside that
transaction, the host emits `todos.changed` only after commit, and `todos.get`
serves the committed snapshot, which the renderer keys by session id and filters
by revision. The Composer TodoDock shows bounded progress and the complete
ordered list scrolled inside its own box, and remote RACP sessions stay
local-only because RACP v1 has no Todo snapshot operation.

A checklist is also cleared by the host. When a new turn begins, `session.beginTurn`
removes the session's checklist if it is non-empty and every item is
`completed`, advances the revision, and emits `todos.changed` with the empty
snapshot, so a later `TodoWrite` starts a new list rather than continuing the
finished one. A list with any `pending`, `in_progress`, or `cancelled` item is
kept: a cancelled step is unfinished work, and the next turn may resume it. A
failed clear is logged and does not fail the turn.

## Consequences

- Empty checklist writes remain observable through revision advancement.
- A finished checklist does not carry into the next turn; the clear advances the
  revision, so the cleared state stays observable and a stale snapshot cannot
  restore it.
- A multi-turn task whose checklist is fully `completed` at a turn boundary starts
  its next turn without it.
- Session deletion cascades checklist rows; forks start with an empty checklist.
- Plan, Goal, delegated, plugin, and MCP execution paths cannot write the
  checklist through this contract.
- Context-compaction injection is deliberately deferred to a follow-up change.
- Remote Todo parity requires an additive RACP contract in a later change.

## Verification

Host-core tests cover migration, validation, transaction rollback, restart,
revision ordering, fork isolation, cascade deletion, and RPC authorization.
Renderer type checks and TodoDock interaction tests cover revision filtering,
remote-session degradation, session switching, expansion, and full-list display
through the dock's own scrollport.
