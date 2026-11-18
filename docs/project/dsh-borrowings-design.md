# dsh Borrowings — Implemented Batch and Deferred Architecture Designs

Source survey: DeepSeek Harness (`dsh`, deepseek-ai/deepseek-harness, master @
v0.2.2-rc.3). This document records what the `feat/dsh-borrowings` branch
implements, and the design proposals for the items deliberately deferred to
later changes.

## Implemented in this branch

| Borrowed idea | dsh origin | PI-Desktop landing |
| --- | --- | --- |
| Repeat-tool reminder | `guard/repeat-tool-reminder` | `packages/agent-runtime/src/repeat-tool-reminder.ts`: streak tracker (same tool + order-insensitive args), advisory text appended to the result at streaks 3/5/8, reset on each new user message. Never blocks the call. |
| Subagent cannot manage schedules | `schedule` tool subagent refusal | Agent runtime marks every delegate tool call (`delegate: true` on `tools.execute`); host-core `scheduled_tools` refuses those calls with `SUBAGENT_DENIED`. |
| Executable-entrypoint discipline | `scripts/verify-application-entrypoints.ts` | `scripts/check-executable-entrypoints.mjs` (`pnpm check:entrypoints`): every `bin` (npm + Cargo) needs an explicit named classification. |
| Model-free tool-result pruning | `compaction-tool-result-pruner` | `packages/agent-runtime/src/tool-result-pruner.ts`: above 60% of the hard budget, oversized older tool results keep head + `[middle pruned]` + tail in the request projection only; transcript keeps full results. |
| Spill for plugin/MCP results | `spill` + host `truncate_with_spill` | `packages/agent-runtime/src/tool-result-spill.ts`: `plugin_*` results over 64k chars persist to `<scratch>/tool-results/` and the model sees head + locator marker + tail. |
| Cross-session introspection | `session_search` tool | New `SessionSearch` Agent-mode tool: host-core `rpc/session_query_tools.rs` reuses the desktop search projection (messages + FTS5), scoped to the calling session's project, read-only (Risk::Low). |
| Workflow vocabulary | `workflow` (`agent/parallel/pipeline`) | No new machinery: PI already fans out (parallel `Task`) and converges (`TaskWait`). The `Task` description now names the vocabulary explicitly, including pipeline via `TaskWait` → next `Task`/`resume`. |
| Consequence-aware options | community `dsh-ask-panel` | `AskToolOption.impact` (summary / changes / files / effects / risk / cost / reversible) flows from the model through `normalizeAskToolImpact` into a flyout rendered in a portal, shown on hover and on keyboard focus. It prefers the option's right, flips left, and floats above the card in a narrow window, because the option list scrolls and clips overflow. PI adds impact as a first-class field instead of the plugin's `\n[[impact]]` encoding inside `description`, because PI owns both halves. |
| Decline is a decision | community `dsh-ask-panel` | `AskToolResolution.disposition` (`proceed` / `halt`): declining an asktool prompt opens a handoff card that asks who makes the call. `proceed` hands the decision back to the agent; `halt` returns the tool result with `terminate: true`, so the loop issues no further model request. pi applies `terminate` per batch, so a sibling tool that finished first leaves the turn running — the halt text then tells the model to stop and report. |
| When to ask, in the prompt | community `dsh-ask-panel` | The plugin reports that a tool without prompt guidance is never called (0 calls across three existing sessions). PI now carries an "Asking the user" band in the runtime system prompt next to the tool description, naming when a fork justifies asking and when it does not. |
| Required consequence | community `dsh-ask-panel`, follow-up | `impact` started optional and the model then wrote the consequence into the option label and left the field empty, so no card ever showed a preview. It is now part of the required schema, the runtime rejects the whole request (`ASKTOOL_MISSING_IMPACT`, listing the offending labels) before a card opens, and the string option shorthand is gone because a bare string cannot carry a consequence. |
| Hand one question back | community `dsh-ask-panel` | Every question carries a synthetic "decide it yourself" choice rendered by the card, never sent to the model. Choosing it defers that question alone: `AskToolResolution.deferred` lists the handoffs, the remaining answers survive, and the tool result marks those questions `(handed back to you: decide it yourself)` plus one instruction not to ask them again. Every question deferred is the whole prompt deferred and reuses the `proceed` path, so a mixed prompt never loses the answers it already has the way the plugin's single proceed label does. |

## Deferred designs

### 1. Capability seam for fs + subprocess (partial adoption)

dsh splits every replaceable capability into Service Definition / Provider /
Consumer and, crucially, makes the filesystem and process providers share one
"execution world": pointing both at a remote sandbox moves Bash, PTY, and LSP
in one step.

Proposal for PI: introduce **one** seam interface (`ExecutionWorld`: fs verbs +
process spawn) owned by host-core, with the current local implementation as the
default provider. Do **not** adopt dsh's three-package split — one interface
module plus one provider per world (local now, remote/SSH later) is enough.
Trigger to build: the first concrete remote-workspace requirement. Building it
earlier would be abstraction without a second implementation.

Trade-offs: a seam interface designed before the second provider exists risks
missing verbs the remote world needs (watch, symlink semantics, ACLs). The dsh
mitigation — designing Definition, Provider, and Consumer together — applies
to the interface review, not to package structure.

### 2. Session-log discipline ("model-visible is recorded")

dsh's invariant: every model-visible input must exist as an append-only
session event; message history is always a projection of the log. Persisted
files use immutable generation names (`session.vN.jsonl[.zstd]`) that are
never renamed, replaced, or deleted, and format evolution rides adjacent
single-step migration packages (vN → vN+1) composed at open time.

PI status: transcripts are append-only JSONL per session with revision files;
the journal is the source of truth and requests are projections (this
branch's pruner relies on that). Two adoptions are cheap and independent:

- Write the invariant down in `docs/spec/03-runtime/`: any injected,
  model-visible content (skill bodies, scheduled-task prompts, delegation
  reports, pruner markers) must be persisted before or with the request that
  carries it. Most of this already holds; the gap is a stated rule plus a
  review checklist line.
- If the transcript format ever needs a v2, adopt immutable generation file
  names and adjacent single-step migrations instead of in-place upgrades, so
  a crash mid-migration can never destroy the previous generation.

### 3. Plugin-scoped configuration patches

dsh lets users replace any entry's config via layered `cordis.patch.yml`.
Full adoption is rejected for PI: patch power over approval/sandbox policy is
a security regression, and Electron's restart cost is already low.

Proposal (limited form): plugins may declare default configuration in their
manifest; users override per plugin id in settings. Overrides apply to the
plugin's own config only — never to host-core policy objects. This gives the
customization benefit without turning config into a privilege-escalation
surface.

### 4. Self-hosted plugin market index (with the two fixes dsh omits)

dsh's market is a static JSON index on any host; users add index sources
themselves and dsh ships none. The format is a good fit for PI's npm-shaped
plugins, but two dsh omissions are mandatory for PI:

- **Signing**: index and plugin tarballs need signature verification (or at
  minimum pinned hashes recorded at install time). dsh explicitly validates
  only the file format; PI should not.
- **A default, curated index source** maintained in this repository, so the
  install path works out of the box; additional user-added sources stay
  opt-in and are labeled untrusted in the UI.

Build trigger: the first request for a plugin marketplace. Until then the
local directory + `pi-plugin pack` flow is sufficient.

## Explicitly not adopted

- **PTC / `run_code`**: executing model-written programs needs a sandbox and
  an approval model PI does not have; it would bypass the plugin permission
  boundary. Revisit only with a real isolation story.
- **Cordis-style everything-is-a-plugin with config HMR**: the reversible-
  side-effect discipline is valuable, but replacing PI's module system is out
  of scope and the HMR cleanup burden (PTYs, MCP connections, watchers) is
  where dsh itself carries the most lifecycle debt.
- **Subagent multi-backend (claude-code/codex providers)**: PI has a single
  fork backend. When a second backend is genuinely needed, adopt dsh's
  capability flags + create-time validation, not before.
