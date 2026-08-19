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

  // Scroll the active citation into view. Driven by the results table, so hovering or
  // clicking a field pulls its evidence into the viewport even in a long document.
  useEffect(() => {
    if (!activeKey) return;
    const el = marks.current.get(activeKey);
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [activeKey]);

  return (
    <div
      className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ink"
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
