import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { AskToolImpact } from "@pi-desktop/shared";

/** Width of the panel, mirrored in messages.css; measurement wins when they drift. */
const FLYOUT_WIDTH = 300;
/** Gap between the anchor and the panel, and the minimum viewport inset. */
const FLYOUT_GAP = 8;
const VIEWPORT_MARGIN = 12;

type Placement = { left: number; top: number; flipped: boolean };

type Props = {
  /** The option button this preview belongs to. */
  anchor: HTMLElement;
  /** The card, used for the fallback placement in a narrow window. */
  card: HTMLElement;
  label: string;
  impact: AskToolImpact;
  /** The pointer entered the panel: keep it open while it is read. */
  onKeepOpen: () => void;
  /** The pointer left the panel: the card decides when to hide it. */
  onDismiss: () => void;
  onClose: () => void;
};

/**
 * The consequence of one answer, floating beside the option it belongs to.
 *
 * Rendered in a portal on `body`: the option list scrolls and clips overflow,
 * so an in-card panel would be cut off, and a fixed panel inside the card would
 * still be bounded by any transformed ancestor.
 *
 * Placement prefers the option's right, falls back to its left, and floats above
 * the card when the window is too narrow for either — never over the option the
 * user is comparing, and never off-screen.
 */
export function AskToolImpactFlyout({
  anchor,
  card,
  label,
  impact,
  onKeepOpen,
  onDismiss,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<Placement>();

  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const width = ref.current?.offsetWidth ?? FLYOUT_WIDTH;
      const height = ref.current?.offsetHeight ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxTop = Math.max(VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN);

      let left = rect.right + FLYOUT_GAP;
      let flipped = false;
      let overlay = false;
      if (left + width > vw - VIEWPORT_MARGIN) {
        const candidate = rect.left - width - FLYOUT_GAP;
        if (candidate >= VIEWPORT_MARGIN) {
          left = candidate;
          flipped = true;
        } else {
          overlay = true;
          left = VIEWPORT_MARGIN;
        }
      }
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));

      // Above the card in the narrow fallback keeps the option rows readable.
      const preferredTop = overlay
        ? card.getBoundingClientRect().top - height - FLYOUT_GAP
        : rect.top;
      const top = Math.max(VIEWPORT_MARGIN, Math.min(preferredTop, maxTop));

      setPlacement({ left, top, flipped });
    };

    measure();
    window.addEventListener("resize", measure);
    // Capture phase sees inner scrollers (the option list) as well as the page.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, card, impact]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const lists: Array<{ heading: string; items: string[] | undefined; mono?: boolean }> = [
    { heading: t("askTool.impact.changes"), items: impact.changes },
    { heading: t("askTool.impact.files"), items: impact.files, mono: true },
    { heading: t("askTool.impact.effects"), items: impact.effects },
  ];
  const risk = [impact.risk, impact.cost].filter((part): part is string => Boolean(part));

  return createPortal(
    <aside
      ref={ref}
      className={`asktool-impact ${placement?.flipped ? "flipped" : ""}`}
      role="note"
      aria-live="polite"
      aria-label={t("askTool.impact.title")}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        // Hidden for the measuring pass, so the first paint never flickers at 0,0.
        visibility: placement ? "visible" : "hidden",
      }}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onDismiss}
    >
      <div className="asktool-impact-head">
        <span className="asktool-impact-option">{label}</span>
        {impact.reversible === false ? (
          <span className="asktool-impact-flag">{t("askTool.impact.irreversible")}</span>
        ) : null}
      </div>
      {impact.summary ? <p className="asktool-impact-summary">{impact.summary}</p> : null}
      {lists.map(({ heading, items, mono }) =>
        items ? (
          <div key={heading} className="asktool-impact-section">
            <span className="asktool-impact-heading">{heading}</span>
            <ul className="asktool-impact-list">
              {items.map((item) => (
                <li key={item} className={mono ? "asktool-impact-file" : undefined}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {risk.length > 0 ? (
        <div className="asktool-impact-section">
          <span className="asktool-impact-heading">{t("askTool.impact.risk")}</span>
          <p className="asktool-impact-risk">{risk.join(" · ")}</p>
        </div>
      ) : null}
    </aside>,
    document.body,
  );
}