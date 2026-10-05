"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Cell, CellStatus } from "@/lib/extract";
import type { FieldSpec, FieldType } from "@/lib/schema";
import { scrollPaneTo } from "@/lib/scroll";

/**
 * Four statuses render as four visibly different things. This is the point of the table:
 * a viewer should be able to tell at a glance which values are backed by the document,
 * which are absent from it, and which the model made up and we threw away.
 */
const STATUS_LABEL: Record<CellStatus, string> = {
  found: "cited",
  not_found: "not found",
  unverified: "citation not found",
  invalid: "type mismatch",
};

/** Short forms for the eyebrow beside a field name; the schema builder has the long ones. */
const TYPE_SHORT: Record<FieldType, string> = {
  string: "Text",
  number: "Number",
  boolean: "Yes / no",
  date: "Date",
  enum: "One of",
  string_list: "List",
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export function StatusChip({ status, label }: { status: CellStatus; label?: string }) {
  const tone =
    status === "found"
      ? "bg-mark px-1.5 py-0.5 text-on-mark"
      : status === "not_found"
        ? "border border-dashed border-ink-3 px-[5px] py-px text-ink-2"
        : "bg-flag px-1.5 py-0.5 text-paper";
  return (
    <span className={`eyebrow inline-block rounded-[3px] whitespace-nowrap ${tone}`}>
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

type LinkedProps = {
  cells: Cell[];
  /** Footnote number per field key, matching the numbers on the document's highlights. */
  numbers: Map<string, number>;
  activeKey: string | null;
  pinnedKey: string | null;
  onHoverKey: (key: string | null) => void;
  onSelectKey: (key: string | null) => void;
  /** The pane these rows scroll inside. */
  scrollPane: RefObject<HTMLElement | null>;
};

/**
 * The other half of the two-way link. The document scrolls to a span when its row is
 * pinned; this scrolls the row into view when the pin came from the document or the
 * stepper. Returns a ref callback to hang on each row.
 */
function usePinnedRow(pinnedKey: string | null, scrollPane: RefObject<HTMLElement | null>) {
  const rows = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (pinnedKey) scrollPaneTo(scrollPane.current, rows.current.get(pinnedKey));
  }, [pinnedKey, scrollPane]);

  return (key: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  };
}

export function ResultsTable({
  cells,
  fields,
  numbers,
  activeKey,
  pinnedKey,
  onHoverKey,
  onSelectKey,
  scrollPane,
}: LinkedProps & { fields: FieldSpec[] }) {
  const specs = new Map(fields.map((f) => [f.key, f]));
  const rowRef = usePinnedRow(pinnedKey, scrollPane);

  return (
    <ul data-results className="flex flex-col">
      {cells.map((cell) => {
        const isActive = activeKey === cell.key;
        const isPinned = pinnedKey === cell.key;
        // Only a located citation has somewhere to jump to. Rows with no span stay inert
        // rather than offering a click that does nothing.
        const citable = cell.status === "found" && cell.span !== null;
        const spec = specs.get(cell.key);
        const number = numbers.get(cell.key);

        const heading = (
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium tracking-tight">
              {number !== undefined && (
                <span className="cite-tag mr-2 align-[1px]" aria-label={`Citation ${number}`}>
                  {number}
                </span>
              )}
              {spec?.label || cell.key}
              {spec && (
                <span className="eyebrow ml-2 font-normal text-ink-3">
                  {TYPE_SHORT[spec.type]}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {isPinned && <span className="eyebrow text-ink-2">pinned</span>}
              <StatusChip status={cell.status} />
            </span>
          </span>
        );

        const rowClass =
          "block w-full rounded-md border p-3 text-left transition-colors " +
          (isPinned ? "border-ink " : "border-transparent ") +
          (isActive ? "bg-raise" : "");

        return (
          <li key={cell.key} className="border-t border-rule py-1">
            {citable ? (
              <button
                type="button"
                ref={rowRef(cell.key)}
                aria-pressed={isPinned}
                onMouseEnter={() => onHoverKey(cell.key)}
                onMouseLeave={() => onHoverKey(null)}
                onClick={() => onSelectKey(isPinned ? null : cell.key)}
                className={`${rowClass} cursor-pointer hover:bg-raise`}
              >
                {heading}
                <span className="mt-1.5 block font-mono text-[15px] font-medium break-words">
                  {formatValue(cell.value)}
                </span>
                {cell.quote && (
                  <span className="mt-1.5 block text-[12.5px] leading-[1.7]">
                    <mark className="cite" data-active={isActive}>
                      {cell.quote}
                    </mark>
                  </span>
                )}
              </button>
            ) : (
              <div className={rowClass}>
                {heading}

                {cell.status === "found" && (
                  <>
                    <p className="mt-1.5 font-mono text-[15px] font-medium break-words">
                      {formatValue(cell.value)}
                    </p>
                    {cell.quote && (
                      <p className="mt-1.5 text-[12.5px] leading-[1.7]">
                        <mark className="cite">{cell.quote}</mark>
                      </p>
                    )}
                  </>
                )}

                {cell.status !== "found" && (
                  <p className="mt-1.5 font-mono text-[15px] font-medium text-ink-3">null</p>
                )}

                {cell.status === "not_found" && (
                  <p className="mt-1.5 text-[12.5px] text-ink-2">
                    The document doesn&apos;t state this.
                  </p>
                )}

                {(cell.status === "unverified" || cell.status === "invalid") &&
                  cell.rejected != null && (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                      Model proposed{" "}
                      <span className="font-mono text-flag line-through">
                        {formatValue(cell.rejected.value)}
                      </span>
                      {cell.status === "unverified"
                        ? " but its quote is not in the document. Discarded."
                        : " which does not match the declared type. Discarded."}
                    </p>
                  )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The same result as the JSON a caller would receive: one key per field, typed values,
 * null for anything not found or discarded. Cited lines are linked to the document
 * exactly like table rows.
 */
export function JsonView({
  cells,
  numbers,
  activeKey,
  pinnedKey,
  onHoverKey,
  onSelectKey,
  scrollPane,
}: LinkedProps) {
  const rowRef = usePinnedRow(pinnedKey, scrollPane);
  const lineBase = "flex w-full items-baseline gap-2 rounded border px-2.5 py-[3px] text-left";

  return (
    <div
      data-json
      className="flex flex-col gap-px rounded-md border border-rule bg-raise px-1.5 py-3 font-mono text-[13px] leading-[1.6]"
    >
      <span className="px-[11px] text-ink-3">{"{"}</span>
      {cells.map((cell, i) => {
        const isActive = activeKey === cell.key;
        const isPinned = pinnedKey === cell.key;
        const citable = cell.status === "found" && cell.span !== null;
        const found = cell.status === "found";
        const discarded = cell.status === "unverified" || cell.status === "invalid";
        const number = numbers.get(cell.key);
        const comma = i < cells.length - 1 ? "," : "";

        const body = (
          <>
            {number !== undefined ? (
              <span className="cite-tag" aria-label={`Citation ${number}`}>
                {number}
              </span>
            ) : (
              <span className="w-[18px] shrink-0" />
            )}
            <span className="min-w-0 flex-1 break-words">
              <span className="text-ink-3">{JSON.stringify(cell.key)}:</span>{" "}
              <span className={found ? "" : "text-ink-3"}>
                {found ? JSON.stringify(cell.value) : "null"}
              </span>
              <span className="text-ink-3">{comma}</span>
            </span>
            {discarded && <StatusChip status={cell.status} label="discarded" />}
          </>
        );

        return citable ? (
          <button
            key={cell.key}
            type="button"
            ref={rowRef(cell.key)}
            aria-pressed={isPinned}
            onMouseEnter={() => onHoverKey(cell.key)}
            onMouseLeave={() => onHoverKey(null)}
            onClick={() => onSelectKey(isPinned ? null : cell.key)}
            className={`${lineBase} cursor-pointer transition-colors hover:bg-paper ${
              isPinned ? "border-ink" : "border-transparent"
            } ${isActive ? "bg-paper" : ""}`}
          >
            {body}
          </button>
        ) : (
          <div key={cell.key} className={`${lineBase} border-transparent`}>
            {body}
          </div>
        );
      })}
      <span className="px-[11px] text-ink-3">{"}"}</span>
    </div>
  );
}

export function StatsBar({ cells }: { cells: Cell[] }) {
  const counts = cells.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const items: Array<[CellStatus, string, string]> = [
    ["found", "cited", "bg-mark"],
    ["not_found", "not found", "bg-rule"],
    ["unverified", "discarded", "bg-flag"],
    ["invalid", "invalid", "bg-flag"],
  ];
  const present = items.filter(([status]) => counts[status]);

  return (
    <div className="flex flex-col gap-2">
      {/* Proportions only. The counts underneath carry the meaning for anyone who can't
          tell the segments apart. */}
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {present.map(([status, , tone]) => (
          <div key={status} className={tone} style={{ flexGrow: counts[status], flexBasis: 0 }} />
        ))}
      </div>
      <div className="eyebrow flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
        {present.map(([status, label]) => (
          <span key={status}>
            {counts[status]} {label}
          </span>
        ))}
      </div>
    </div>
  );
}
