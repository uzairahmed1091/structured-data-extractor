"use client";

import { useEffect, useMemo, useRef } from "react";
import { segmentByCitations, type Span } from "@/lib/locate";
import type { Cell } from "@/lib/extract";

/**
 * Read-only render of the document with every located citation lit up.
 *
 * The offsets in cell.span index into the exact string that was sent to the model, so this
 * component must be handed that same string. Re-parsing or re-normalizing the text before
 * rendering will drift the spans off by however many characters the normalizer moved.
 */
export function SourceView({
  text,
  cells,
  activeKey,
  pinnedKey,
  onHoverKey,
  onSelectKey,
}: {
  text: string;
  cells: Cell[];
  activeKey: string | null;
  pinnedKey: string | null;
  onHoverKey: (key: string | null) => void;
  onSelectKey: (key: string | null) => void;
}) {
  const segments = useMemo(() => {
    const citations = cells
      .filter((c): c is Cell & { span: Span } => c.status === "found" && c.span !== null)
      .map((c) => ({ key: c.key, span: c.span }));
    return segmentByCitations(text, citations);
  }, [text, cells]);

  const marks = useRef(new Map<string, HTMLElement>());
  const container = useRef<HTMLDivElement>(null);

  /**
   * Bring a pinned citation into view — and only a *pinned* one. Scrolling on hover means
   * the page moves under the pointer while someone is reading the results list, which on a
   * stacked layout makes the list impossible to scroll at all: every row you pass yanks
   * you somewhere else.
   *
   * This also scrolls the pane by hand rather than calling scrollIntoView(), which walks
   * every scrollable ancestor up to the window and drags the whole document with it.
   */
  useEffect(() => {
    if (!pinnedKey) return;

    const pane = container.current;
    const el = marks.current.get(pinnedKey);
    if (!pane || !el) return;

    const paneBox = pane.getBoundingClientRect();
    const markBox = el.getBoundingClientRect();

    // Already comfortably in view: leave the scroll position alone.
    if (markBox.top >= paneBox.top && markBox.bottom <= paneBox.bottom) return;

    const offset =
      markBox.top - paneBox.top - (pane.clientHeight - markBox.height) / 2;

    pane.scrollTo({
      top: pane.scrollTop + offset,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [pinnedKey]);

  return (
    <div
      ref={container}
      className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ink"
      onMouseLeave={() => onHoverKey(null)}
    >
      {segments.map((seg, i) => {
        const key = seg.keys[0];
        if (!key) return <span key={i}>{seg.text}</span>;

        const isActive = key === activeKey;
        const isPinned = key === pinnedKey;

        return (
          <mark
            key={i}
            ref={(el) => {
              if (el) marks.current.set(key, el);
            }}
            role="button"
            tabIndex={0}
            aria-pressed={isPinned}
            aria-label={`Citation for ${key}`}
            onMouseEnter={() => onHoverKey(key)}
            onClick={() => onSelectKey(isPinned ? null : key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectKey(isPinned ? null : key);
              }
            }}
            className={`cursor-pointer rounded-[2px] px-px transition-colors ${
              isActive
                ? "bg-mark-deep text-ink"
                : "bg-mark text-ink hover:bg-mark-deep"
            } ${isPinned ? "outline outline-1 outline-offset-1 outline-ink" : ""}`}
          >
            {seg.text}
          </mark>
        );
      })}
    </div>
  );
}
