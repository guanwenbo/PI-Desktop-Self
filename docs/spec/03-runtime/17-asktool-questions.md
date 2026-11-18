# 17. asktool Interactive Questions

## 1. Purpose

`asktool` lets the model pause a turn and ask the user one or more bounded
questions. It is available in Agent, Plan, and Goal mode and is separate from
permission approval: it does not authorize an operation and has no validity
deadline.

## 2. Request shape

The tool accepts a non-empty `questions` array. Each question contains:

- `question`: the prompt text, which may include Markdown;
- `options`: one or more selectable answers. Each option is an object with a
  required Markdown `label`, an optional plain-text `description`, and a
  required `impact` whose `summary` states in one line what choosing it does;
- `multiSelect`: optional; when true, more than one selectable answer is allowed.

Each question prompt is limited to 300 Unicode characters, including Markdown
source. Longer prompts are rejected by the runtime before a pending card is
created, so the model can retry with a shorter question. The character count
uses Unicode code points, so a supplementary-plane character counts once.

A request whose options omit `impact.summary` is rejected as a whole with
`ASKTOOL_MISSING_IMPACT` before any card is created, and the error names the
offending labels. An option with no stated consequence is not an answer the
user can weigh, so failing and letting the model fill the field is better than
opening a card of bare labels. `changes`, `files`, `effects`, `risk`, `cost`,
and `reversible` are optional and render only when present. The string option
shorthand is no longer offered, because a bare string cannot carry a
consequence.

The card renders CommonMark/GFM text formatting such as emphasis, inline code,
paragraphs, and lists. Links render as non-interactive text, images as alt
text, and raw HTML is ignored. Question text and option labels use the same
renderer; descriptions and impact fields remain plain text. Rendering never
rewrites the option value: selection and the model-facing answer use its
normalized source label. Hovering or focusing an option floats its consequence
in a panel beside the row. The desktop card always adds one extra `Enter
another answer` option with a text field, and one `decide it yourself` option
per question; the model supplies neither.

## 3. Card interaction

Only one question is shown at a time. A small indicator is rendered for every
question and uses four states: unanswered, answered, skipped, and handed back.
Selecting an indicator revisits that question. `Next` records an answer when one
exists; otherwise it records a skip. `Skip` explicitly records a skip and
advances. `Decline all` opens a handoff card that asks who makes the call:
`proceed` hands the decision back to the agent, `halt` ends the turn.

Handing a question back is a per-question decision. Choosing it replaces that
question's selection, and submitting sends its index in
`AskToolResolution.deferred` with a `null` answer; the other questions keep the
answers they have. When every question is handed back, the resolution carries
no deferral and behaves as a whole-prompt decline that hands the decision back.
A deferral sent together with an answer for the same question is rejected by the
runtime, so "answered" and "handed back" can never both be true.

There is no timer, countdown, or automatic expiration. The card remains pending
until the user submits or the turn is stopped. If the turn is stopped while a
card is open, the runtime resolves every remaining question as skipped.

When an ask arrives, the app shows an in-app toast with a stable localized
prompt title and the first question; background sessions also follow the
existing native notification policy. Ask titles deliberately do not interpolate
the session title, because generated titles may contain tool-call text. The ask
event plays one soft in-app chime; its toast does not play a second one.

The toast retains its originating session. Clicking its message, or activating
the focused message button with Enter/Space, opens the conversation through
normal session selection, including project alignment and pending-question
restoration, then dismisses the toast only after success. Receipt alone never navigates. Closing the
toast or selecting its text does not open a conversation. Hover and keyboard
focus pause auto-dismiss. Identical prompts from different sessions keep
separate targets; repeats within one session still replace the earlier toast.
Navigation failures show an error toast and retain the original reminder for
retry without resolving the pending question.
Ordinary toasts without a session target remain non-interactive.

## 4. Tool output

The response is the normal tool result returned to the model and persisted with
the tool row. Markdown source is retained in the serialized question and
selected label; rendering is presentation-only. For each question, content is
serialized as:

```text
question text：answer label 1、answer label 2
```

Multiple questions are separated by `\n---\n`. A skipped or unanswered
question keeps the question text and uses an empty placeholder:

```text
question text：
```

A question handed back to the agent keeps its text and serializes the marker
below, followed by one instruction not to ask those questions again:

```text
question text：(handed back to you: decide it yourself)
```

A whole-prompt decline is not an empty answer either: the result carries a fixed
instruction to decide the open question and continue (`proceed`), or to stop
with no further tool call and report what is done and what is still open
(`halt`).

This format is deterministic, preserves question order, and makes multi-select
answers distinguishable without exposing a renderer-only state object to the
model.

## 5. Transcript summary

The completed asktool row in conversation history presents persisted
`details.questions` and `details.answers` as an ordered question-and-answer
summary. Multi-select answers remain separate labels, and skipped questions
have an explicit localized state. This is a read-only projection: the
model-facing text and stored tool result are unchanged. If structured details
are unavailable or invalid, the transcript keeps its generic result rendering
so imported or malformed history remains inspectable.
