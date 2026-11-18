import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const cardSource = await readFile(
  new URL("../src/components/AskToolCard.tsx", import.meta.url),
  "utf8",
);
const flyoutSource = await readFile(
  new URL("../src/components/AskToolImpactFlyout.tsx", import.meta.url),
  "utf8",
);
const draftSource = await readFile(
  new URL("../src/lib/pending-asks.ts", import.meta.url),
  "utf8",
);
const styleSource = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

/** Every key the consequence preview renders. */
const IMPACT_KEYS = [
  "title",
  "changes",
  "files",
  "effects",
  "risk",
  "irreversible",
];
/** Every key the decline handoff renders. */
const HANDOFF_KEYS = ["note", "proceed", "proceedDesc", "halt", "haltDesc"];

test("asktool previews an option's consequence on hover and on keyboard focus", () => {
  assert.match(cardSource, /askToolOptionImpact/);
  assert.match(cardSource, /onMouseEnter=\{\(\) => \{/);
  assert.match(cardSource, /onFocus=\{\(\) => \{/);
  assert.match(cardSource, /setPreview\(\{ question: index, option: optionIndex \}\)/);
  // Leaving the row only schedules the hide, so the pointer can cross into the
  // panel; entering the panel cancels that timer.
  assert.match(cardSource, /onMouseLeave=\{scheduleHide\}/);
  assert.match(cardSource, /onDismiss=\{scheduleHide\}/);
  assert.match(cardSource, /onKeepOpen=\{cancelHide\}/);
  // The preview belongs to one question: switching questions drops it without
  // an effect that would clear it one render too late.
  assert.match(cardSource, /preview\.question === index/);
  assert.match(cardSource, /data-option-index=\{optionIndex\}/);
});

test("the consequence panel floats in a portal and escapes the scrolling list", () => {
  assert.match(flyoutSource, /createPortal\(/);
  assert.match(flyoutSource, /document\.body/);
  // The option list scrolls and clips overflow, so the panel must not be a
  // child of it, and it re-anchors while that list scrolls.
  assert.match(flyoutSource, /window\.addEventListener\("scroll", measure, true\)/);
  assert.match(flyoutSource, /window\.addEventListener\("resize", measure\)/);
  // Right, then left, then above the card in a narrow window.
  assert.match(flyoutSource, /let left = rect\.right \+ FLYOUT_GAP;/);
  assert.match(flyoutSource, /left = candidate;\s*\n\s*flipped = true;/);
  assert.match(flyoutSource, /card\.getBoundingClientRect\(\)\.top - height - FLYOUT_GAP/);
  // Hidden for the measuring pass so the first paint never flickers at 0,0.
  assert.match(flyoutSource, /visibility: placement \? "visible" : "hidden"/);
  assert.match(flyoutSource, /event\.key === "Escape"/);
});

test("the consequence panel renders each supplied section and nothing for absent ones", () => {
  for (const className of [
    "asktool-impact-summary",
    "asktool-impact-heading",
    "asktool-impact-list",
    "asktool-impact-risk",
  ]) {
    assert.match(flyoutSource, new RegExp(`className="${className}"`), className);
  }
  assert.match(flyoutSource, /mono \? "asktool-impact-file" : undefined/);
  assert.match(flyoutSource, /\{impact\.summary \? <p/);
  assert.match(flyoutSource, /\{lists\.map\(\(\{ heading, items, mono \}\) =>/);
  assert.match(flyoutSource, /\{risk\.length > 0 \? \(/);
  assert.match(flyoutSource, /\{impact\.reversible === false \? \(/);

  const block = styleSource.slice(
    styleSource.indexOf(".asktool-impact {"),
    styleSource.indexOf(".asktool-impact-head {"),
  );
  assert.match(block, /position: fixed/);
  assert.match(block, /box-shadow/);
  // The pointer crosses the gap between the row and the panel through this.
  assert.match(styleSource, /\.asktool-impact::before \{/);
  assert.match(styleSource, /\.asktool-impact\.flipped::before \{/);
});

test("declining asks who makes the call instead of dismissing the question", () => {
  // The decline button opens the handoff card; it no longer resolves the ask.
  assert.match(cardSource, /setDeclining\(true\)/);
  assert.doesNotMatch(
    cardSource,
    /className="asktool-decline"[\s\S]{0,200}void submit\(drafts, request\.questions\.map\(\(\) => null\)\)/,
  );
  assert.match(cardSource, /\{declining \? \(/);
  for (const className of [
    "asktool-handoff",
    "asktool-handoff-note",
    "asktool-handoff-choice",
    "asktool-handoff-choice-title",
    "asktool-handoff-choice-copy",
  ]) {
    assert.match(cardSource, new RegExp(`className="${className}"`), className);
  }
  // Each choice submits a disposition with no answers.
  assert.match(cardSource, /\["proceed", "askTool\.handoff\.proceed"/);
  assert.match(cardSource, /\["halt", "askTool\.handoff\.halt"/);
  assert.match(
    cardSource,
    /void submit\(drafts, request\.questions\.map\(\(\) => null\), disposition\)/,
  );
  assert.match(cardSource, /disposition\?: AskToolDisposition/);
  // The handoff choice rides through as the settled disposition, which is how a
  // card that hands every question back reaches the same proceed path.
  assert.match(cardSource, /\.\.\.\(settled \? \{ disposition: settled \} : \{\}\)/);
  assert.match(styleSource, /\.asktool-handoff-choice:hover \{/);
});

test("every shipped locale carries the preview and handoff copy", async () => {
  const localesDir = new URL("../../../packages/i18n/src/locales/", import.meta.url);
  const locales = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.ok(locales.length >= 9, `found ${locales.length} locale directories`);
  const seen = new Map();
  for (const locale of locales) {
    const source = await readFile(new URL(`${locale}/index.ts`, localesDir), "utf8");
    for (const [blockName, keys] of [
      ["impact", IMPACT_KEYS],
      ["handoff", HANDOFF_KEYS],
    ]) {
      const start = Math.max(
        source.indexOf(`"${blockName}": {`),
        source.indexOf(`${blockName}: {`),
      );
      assert.ok(start >= 0, `${locale}: askTool.${blockName} block is missing`);
      const block = source.slice(start, source.indexOf("},", start));
      for (const key of keys) {
        const match = block.match(new RegExp(`"?${key}"?:\\s*"([^"]*)"`));
        assert.ok(match, `${locale}: askTool.${blockName}.${key}`);
        assert.ok(match[1].trim(), `${locale}: ${blockName}.${key} must not be blank`);
        const seenKey = `${blockName}.${key}:${match[1]}`;
        assert.equal(seen.has(seenKey), false, `${locale}: ${seenKey} duplicates ${seen.get(seenKey)}`);
        seen.set(seenKey, locale);
      }
    }
  }
});

test("a question can be handed back to the agent instead of answered", () => {
  // The option is the card's own: the model never sees it, so it needs no
  // consequence of its own and must not borrow the preview anchor of a row.
  assert.match(cardSource, /asktool-defer-option/);
  assert.match(cardSource, /t\("askTool\.deferOption"\)/);
  assert.match(cardSource, /t\("askTool\.deferOptionHint"\)/);
  assert.match(cardSource, /onClick=\{deferCurrent\}/);
  const deferBlock = cardSource.slice(cardSource.indexOf("asktool-defer-option"));
  assert.doesNotMatch(deferBlock.slice(0, 900), /data-option-index/);
  assert.match(deferBlock, /onMouseEnter=\{\(\) => setPreview\(undefined\)\}/);
  // Choosing it replaces whatever this question held.
  assert.match(cardSource, /const deferCurrent = \(\) => \{[\s\S]{0,260}deferred: true,/);
  assert.match(draftSource, /deferred: boolean;/);
  assert.match(styleSource, /\.asktool-defer-option \{/);
});

test("handing a question back resolves it as deferred, not as an answer", () => {
  assert.match(cardSource, /deferredIndexes/);
  assert.match(cardSource, /draft\.deferred === true \? \[draftIndex\] : \[\]/);
  // Every question handed back is the whole prompt handed back; a partial one
  // travels as indexes so the runtime never sees a deferral beside an answer.
  assert.match(cardSource, /handedBack\.length === nextDrafts\.length/);
  assert.match(
    cardSource,
    /\.\.\.\(settled \|\| handedBack\.length === 0 \? \{\} : \{ deferred: handedBack \}\)/,
  );
  assert.match(cardSource, /draft\.deferred !== true && currentValues\(draft\)\.length === 0/);
  assert.match(cardSource, /if \(draft\.deferred === true\) return "deferred" as const;/);
  assert.match(styleSource, /\.asktool-indicator\.deferred \{/);
});

test("every shipped locale names the handed-back option", async () => {
  const localesDir = new URL("../../../packages/i18n/src/locales/", import.meta.url);
  const locales = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const locale of locales) {
    const source = await readFile(new URL(`${locale}/index.ts`, localesDir), "utf8");
    for (const key of ["deferOption", "deferOptionHint"]) {
      const hits = source.match(new RegExp(`"?${key}"?:\\s*"[^"]+"`, "g")) ?? [];
      assert.equal(hits.length, 1, `${locale}: askTool.${key}`);
    }
  }
});