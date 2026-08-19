"use client";

import type { Cell, CellStatus } from "@/lib/extract";
import type { FieldSpec } from "@/lib/schema";

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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function StatusChip({ status }: { status: CellStatus }) {
  const tone =
    status === "found"
      ? "bg-mark text-ink"
      : status === "not_found"
        ? "border border-rule text-ink-3"
        : "bg-flag text-paper";
  return (
    <span className={`eyebrow inline-block rounded-sm px-1.5 py-0.5 ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ResultsTable({
  cells,
  fields,
  activeKey,
  pinnedKey,
  onHoverKey,
  onSelectKey,
}: {
  cells: Cell[];
  fields: FieldSpec[];
  activeKey: string | null;
  pinnedKey: string | null;
  onHoverKey: (key: string | null) => void;
  onSelectKey: (key: string | null) => void;
}) {
  const labels = new Map(fields.map((f) => [f.key, f.label || f.key]));

  return (
    <ul className="divide-y divide-rule border-t border-rule">
      {cells.map((cell) => {
        const isActive = activeKey === cell.key;
        const isPinned = pinnedKey === cell.key;
        // Only a located citation has somewhere to jump to. Rows with no span stay inert
        // rather than offering a click that does nothing.
        const citable = cell.status === "found" && cell.span !== null;

        return (
          <li
            key={cell.key}
            onMouseEnter={() => citable && onHoverKey(cell.key)}
            onMouseLeave={() => citable && onHoverKey(null)}
            onClick={() => citable && onSelectKey(isPinned ? null : cell.key)}
            onKeyDown={(e) => {
              if (!citable) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectKey(isPinned ? null : cell.key);
              }
            }}
            role={citable ? "button" : undefined}
            tabIndex={citable ? 0 : undefined}
            aria-pressed={citable ? isPinned : undefined}
            className={`px-1 py-3 transition-colors ${citable ? "cursor-pointer" : ""} ${
              isActive ? "bg-field" : ""
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium tracking-tight">
                {labels.get(cell.key) ?? cell.key}
              </span>
              <StatusChip status={cell.status} />
            </div>

            {cell.status === "found" && (
              <>
                <p className="mt-1 font-mono text-sm break-words text-ink">
                  {formatValue(cell.value)}
                </p>
                {cell.quote && (
                  <blockquote className="mt-1.5 border-l-2 border-mark-deep pl-2 text-xs leading-relaxed text-ink-2">
                    {cell.quote}
                  </blockquote>
                )}
              </>
            )}

            {cell.status === "not_found" && (
              <p className="mt-1 font-mono text-sm text-ink-3">null</p>
            )}

            {(cell.status === "unverified" || cell.status === "invalid") && (
              <>
                <p className="mt-1 font-mono text-sm text-ink-3">null</p>
                {cell.rejected != null && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                    Model proposed{" "}
                    <span className="font-mono text-flag line-through">
                      {formatValue(cell.rejected.value)}
                    </span>
                    {cell.status === "unverified"
                      ? " but its quote is not in the document. Discarded."
                      : " which does not match the declared type. Discarded."}
                  </p>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function StatsBar({ cells }: { cells: Cell[] }) {
  const counts = cells.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const items: Array<[CellStatus, string]> = [
    ["found", "cited"],
    ["not_found", "not found"],
    ["unverified", "discarded"],
    ["invalid", "invalid"],
  ];

  return (
    <div className="eyebrow flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
      {items.map(([status, label]) =>
        counts[status] ? (
          <span key={status}>
            {counts[status]} {label}
          </span>
        ) : null,
      )}
    </div>
  );
}
