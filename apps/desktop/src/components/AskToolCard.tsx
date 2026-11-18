import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  askToolOptionDescription,
  askToolOptionImpact,
  askToolOptionLabel,
  type AskToolDisposition,
} from "@pi-desktop/shared";
import { AskToolImpactFlyout } from "./AskToolImpactFlyout";
import { AskToolRichText } from "./AskToolRichText";
import {
  emptyAskDraft,
  type AskDraft,
  type AskDraftAnswer,
  type PendingAsk,
} from "../lib/pending-asks";
import { useAppStore } from "../stores/app-store";
import { Button } from "./ui";

type DraftAnswer = AskDraftAnswer;

const CUSTOM_OPTION = "__asktool_custom__";

export function AskToolCard({ request, queued = 0 }: { request: PendingAsk; queued?: number }) {
  const { t } = useTranslation();
  const resolveAsk = useAppStore((state) => state.resolveAsk);
  const showToast = useAppStore((state) => state.showToast);
  const storedDraft = useAppStore((state) => state.askDrafts[request.requestId]);
  const setAskDraft = useAppStore((state) => state.setAskDraft);
  const [resolving, setResolving] = useState(false);
  // Declining is a decision, not a dismissal: the handoff card asks who makes
  // the call before anything is sent to the runtime.
  const [declining, setDeclining] = useState(false);
  // The store owns the draft, so a session switch (which unmounts this card)
  // cannot reset the answers. Read lazily rather than seeding during render.
  const draft: AskDraft =
    storedDraft && storedDraft.answers.length === request.questions.length
      ? {
          ...storedDraft,
          index: Math.min(
            Math.max(0, storedDraft.index),
            request.questions.length - 1,
          ),
        }
      : emptyAskDraft(request.questions);
  const index = draft.index;
  const drafts = draft.answers;
  const updateDraft = (next: AskDraft) => setAskDraft(request.requestId, next);
  const setIndex = (nextIndex: number) =>
    updateDraft({ ...draft, index: nextIndex });
  const current = request.questions[index];
  const currentDraft = drafts[index];
  const optionsRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  // Which answer's consequence is on screen. Keyed by question so switching
  // questions drops a preview that no longer belongs to the visible list,
  // without an effect that would clear it one render too late.
  const [preview, setPreview] = useState<{ question: number; option: number }>();
  const hideTimer = useRef<number>(0);
  const cancelHide = () => window.clearTimeout(hideTimer.current);
  // Leaving the option row only schedules the hide: the pointer needs a moment
  // to cross the gap into the panel before the panel disappears under it.
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setPreview(undefined), 220);
  };
  useEffect(() => cancelHide, []);
  const previewOffset =
    preview && preview.question === index ? preview.option : undefined;
  const previewOption =
    previewOffset === undefined ? undefined : current.options[previewOffset];
  const previewImpact = previewOption ? askToolOptionImpact(previewOption) : undefined;
  const previewAnchor =
    previewOffset === undefined || !optionsRef.current
      ? undefined
      : optionsRef.current.querySelector<HTMLElement>(
          `[data-option-index="${previewOffset}"]`,
        ) ?? undefined;

  const currentValues = (draft: DraftAnswer): string[] => [
    ...draft.values,
    ...(draft.customSelected && draft.customText.trim()
      ? [draft.customText.trim()]
      : []),
  ];

  const statuses = useMemo(
    () =>
      drafts.map((draft) => {
        if (draft.skipped) return "skipped" as const;
        return currentValues(draft).length > 0 ? "answered" as const : "unanswered" as const;
      }),
    [drafts],
  );

  const updateCurrentDraft = (update: (answer: DraftAnswer) => DraftAnswer) => {
    updateDraft({
      ...draft,
      answers: drafts.map((answer, draftIndex) =>
        draftIndex === index ? update(answer) : answer,
      ),
    });
  };

  const selectOption = (option: string) => {
    updateCurrentDraft((draft) => {
      if (option === CUSTOM_OPTION) {
        return {
          ...draft,
          customSelected: !draft.customSelected,
          skipped: false,
          ...(current.multiSelect ? {} : { values: [] }),
        };
      }
      if (current.multiSelect) {
        return {
          ...draft,
          values: draft.values.includes(option)
            ? draft.values.filter((value) => value !== option)
            : [...draft.values, option],
          skipped: false,
        };
      }
      return { ...draft, values: [option], customSelected: false, customText: "", skipped: false };
    });
  };

  const answers = (nextDrafts = drafts): Array<string[] | null> =>
    nextDrafts.map((draft) => {
      const values = currentValues(draft);
      return values.length > 0 && !draft.skipped ? values : null;
    });

  const submit = async (
    nextDrafts = drafts,
    explicitAnswers?: Array<string[] | null>,
    disposition?: AskToolDisposition,
  ) => {
    if (resolving) return;
    setResolving(true);
    try {
      await resolveAsk(request.sessionId, {
        requestId: request.requestId,
        sessionId: request.sessionId,
        answers: explicitAnswers ?? answers(nextDrafts),
        ...(disposition ? { disposition } : {}),
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
      setResolving(false);
    }
  };

  const next = () => {
    const nextDrafts = drafts.map((draft, draftIndex) =>
      draftIndex === index && currentValues(draft).length === 0
        ? { ...draft, skipped: true }
        : draft,
    );
    if (index === request.questions.length - 1) {
      updateDraft({ ...draft, answers: nextDrafts });
      void submit(nextDrafts);
    } else {
      updateDraft({ ...draft, answers: nextDrafts, index: index + 1 });
    }
  };

  const skip = () => {
    const nextDrafts = drafts.map((draft, draftIndex) =>
      draftIndex === index ? { ...draft, skipped: true, values: [], customSelected: false } : draft,
    );
    if (index === request.questions.length - 1) {
      updateDraft({ ...draft, answers: nextDrafts });
      void submit(nextDrafts);
    } else {
      updateDraft({ ...draft, answers: nextDrafts, index: index + 1 });
    }
  };

  return (
    <section
      className="asktool-card"
      role="region"
      aria-label={t("askTool.title")}
      ref={cardRef}
    >
      <div className="asktool-card-header">
        <div className="asktool-card-header-main">
          <span className="asktool-card-title" role="status" aria-live="polite">
            {t("askTool.title")}
          </span>
          <span className="asktool-card-progress">
            {t("askTool.progress", { current: index + 1, total: request.questions.length })}
            {queued > 0 ? <span> · {t("askTool.queued", { count: queued })}</span> : null}
          </span>
          <div className="asktool-indicators" aria-label={t("askTool.indicatorLabel")}>
            {statuses.map((status, statusIndex) => (
              <button
                key={`${request.requestId}-${statusIndex}`}
                type="button"
                className={`asktool-indicator ${status} ${statusIndex === index ? "current" : ""}`}
                aria-label={t(`askTool.status.${status}`, { number: statusIndex + 1 })}
                aria-current={statusIndex === index ? "step" : undefined}
                onClick={() => setIndex(statusIndex)}
              />
            ))}
          </div>
        </div>
        <div className="asktool-card-header-actions">
          <button
            type="button"
            className="asktool-decline"
            disabled={resolving}
            aria-expanded={declining}
            onClick={() => {
              cancelHide();
              setPreview(undefined);
              setDeclining(true);
            }}
          >
            {t("askTool.decline")}
          </button>
          <Button variant="ghost" size="sm" disabled={resolving} onClick={skip}>
            {t("askTool.skip")}
          </Button>
          <Button variant="primary" size="sm" disabled={resolving} onClick={next}>
            {index === request.questions.length - 1 ? t("askTool.submit") : t("askTool.next")}
          </Button>
        </div>
      </div>

      <h3 className="asktool-question">
        <span className="asktool-question-number">
          {t("askTool.questionNumber", { number: index + 1 })}
        </span>
        <span key={index} className="asktool-question-body" tabIndex={0}>
          <AskToolRichText source={current.question} />
        </span>
      </h3>
      {declining ? (
        <div className="asktool-handoff">
          <p className="asktool-handoff-note">{t("askTool.handoff.note")}</p>
          {(
            [
              ["proceed", "askTool.handoff.proceed", "askTool.handoff.proceedDesc"],
              ["halt", "askTool.handoff.halt", "askTool.handoff.haltDesc"],
            ] as const
          ).map(([disposition, title, description]) => (
            <button
              key={disposition}
              type="button"
              className="asktool-handoff-choice"
              disabled={resolving}
              onClick={() => void submit(drafts, request.questions.map(() => null), disposition)}
            >
              <span className="asktool-handoff-choice-title">{t(title)}</span>
              <span className="asktool-handoff-choice-copy">{t(description)}</span>
            </button>
          ))}
        </div>
      ) : (
      <div
        className="asktool-options"
        role={current.multiSelect ? "group" : "radiogroup"}
        ref={optionsRef}
        onMouseLeave={scheduleHide}
        onBlur={scheduleHide}
      >
        {current.options.map((option, optionIndex) => {
          const label = askToolOptionLabel(option);
          const description = askToolOptionDescription(option);
          const selected = currentDraft.values.includes(label);
          return (
            <button
              key={`${label}-${optionIndex}`}
              type="button"
              className={`asktool-option ${selected ? "selected" : ""} ${
                previewOffset === optionIndex ? "is-previewing" : ""
              }`}
              data-option-index={optionIndex}
              aria-pressed={current.multiSelect ? selected : undefined}
              aria-checked={!current.multiSelect ? selected : undefined}
              role={current.multiSelect ? "checkbox" : "radio"}
              onMouseEnter={() => {
                cancelHide();
                setPreview({ question: index, option: optionIndex });
              }}
              onFocus={() => {
                cancelHide();
                setPreview({ question: index, option: optionIndex });
              }}
              onClick={() => selectOption(label)}
            >
              <span className="asktool-option-mark" aria-hidden>{selected ? "✓" : ""}</span>
              <span className="asktool-option-copy">
                <span className="asktool-option-rich-label">
                  <AskToolRichText source={label} />
                </span>
                {description ? (
                  <span className="asktool-option-description">{description}</span>
                ) : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className={`asktool-option asktool-custom-option ${currentDraft.customSelected ? "selected" : ""}`}
          aria-pressed={current.multiSelect ? currentDraft.customSelected : undefined}
          aria-checked={!current.multiSelect ? currentDraft.customSelected : undefined}
          role={current.multiSelect ? "checkbox" : "radio"}
          onClick={() => selectOption(CUSTOM_OPTION)}
        >
          <span className="asktool-option-mark" aria-hidden>{currentDraft.customSelected ? "✓" : ""}</span>
          <span>{t("askTool.customOption")}</span>
        </button>
      </div>
      )}
      {previewImpact && previewAnchor && cardRef.current ? (
        <AskToolImpactFlyout
          anchor={previewAnchor}
          card={cardRef.current}
          label={previewOption ? askToolOptionLabel(previewOption) : ""}
          impact={previewImpact}
          onKeepOpen={cancelHide}
          onDismiss={scheduleHide}
          onClose={() => {
            cancelHide();
            setPreview(undefined);
          }}
        />
      ) : null}
      {currentDraft.customSelected ? (
        <input
          className="asktool-custom-input"
          value={currentDraft.customText}
          placeholder={t("askTool.customPlaceholder")}
          aria-label={t("askTool.customOption")}
          onChange={(event) =>
            updateCurrentDraft((draft) => ({ ...draft, customText: event.target.value, skipped: false }))
          }
          autoFocus
        />
      ) : null}

    </section>
  );
}
