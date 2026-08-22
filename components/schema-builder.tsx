"use client";

import { useId } from "react";
import { FIELD_TYPES, MAX_FIELDS, type FieldSpec, type FieldType } from "@/lib/schema";

const TYPE_LABELS: Record<FieldType, string> = {
  string: "Text",
  number: "Number",
  boolean: "Yes / no",
  date: "Date",
  enum: "One of…",
  string_list: "List of text",
};

function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48);
}

function blankField(index: number): FieldSpec {
  return {
    key: `field_${index + 1}`,
    label: "",
    type: "string",
    description: "",
  };
}

/**
 * Width is deliberately not baked in here. Every control sits in a flex row, so its width
 * comes from the flex properties at the call site — a `w-full` carried in the shared class
 * is what let the type select squeeze the name input down to an unusable square.
 */
const controlClass =
  "rounded-sm border border-rule bg-paper px-2.5 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-3 focus:border-ink focus-visible:outline-2 " +
  "focus-visible:outline-offset-0 focus-visible:outline-ink disabled:opacity-50";

export function SchemaBuilder({
  fields,
  onChange,
  disabled,
}: {
  fields: FieldSpec[];
  onChange: (fields: FieldSpec[]) => void;
  disabled?: boolean;
}) {
  const uid = useId();

  const update = (i: number, patch: Partial<FieldSpec>) => {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const usedKeys = new Set(fields.map((f) => f.key));
  const atMax = fields.length >= MAX_FIELDS;

  const addField = () => {
    if (atMax) return;
    onChange([...fields, blankField(fields.length)]);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-rule pb-2">
        <h2 className="text-sm font-semibold tracking-tight">Schema</h2>
        <span className={`eyebrow ${atMax ? "text-warn" : "text-ink-3"}`}>
          {fields.length} / {MAX_FIELDS} fields{atMax ? " · limit" : ""}
        </span>
      </div>

      <ul className="divide-y divide-rule">
        {fields.map((field, i) => {
          const nameId = `${uid}-name-${i}`;
          const typeId = `${uid}-type-${i}`;
          const descId = `${uid}-desc-${i}`;
          const enumId = `${uid}-enum-${i}`;
          const name = field.label || `field ${i + 1}`;

          return (
            <li key={i} className="py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  {/* The name is the primary input: it takes the row's remaining width and
                      the heavier face. min-w-0 is what stops the select from crushing it. */}
                  <div className="flex gap-2">
                    <label htmlFor={nameId} className="sr-only">
                      Field {i + 1} name
                    </label>
                    <input
                      id={nameId}
                      className={`${controlClass} min-w-0 flex-1 font-medium`}
                      value={field.label}
                      disabled={disabled}
                      placeholder="Field name, e.g. Invoice total"
                      onChange={(e) => {
                        const label = e.target.value;
                        const derived = toKey(label);
                        // Only auto-derive while the key is still untouched or unique-able.
                        const key =
                          derived && (!usedKeys.has(derived) || derived === field.key)
                            ? derived
                            : field.key;
                        update(i, { label, key: key || field.key });
                      }}
                    />

                    <label htmlFor={typeId} className="sr-only">
                      Type of {name}
                    </label>
                    <select
                      id={typeId}
                      className={`${controlClass} w-36 shrink-0 text-ink-2`}
                      value={field.type}
                      disabled={disabled}
                      onChange={(e) => {
                        const type = e.target.value as FieldType;
                        update(i, {
                          type,
                          enumValues:
                            type === "enum" ? (field.enumValues ?? ["", ""]) : undefined,
                        });
                      }}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label htmlFor={descId} className="sr-only">
                    Description of {name}
                  </label>
                  <input
                    id={descId}
                    className={`${controlClass} w-full`}
                    value={field.description ?? ""}
                    disabled={disabled}
                    placeholder="What counts as this field? (sent to the model verbatim)"
                    onChange={(e) => update(i, { description: e.target.value })}
                  />

                  {field.type === "enum" && (
                    <>
                      <label htmlFor={enumId} className="sr-only">
                        Allowed values for {name}
                      </label>
                      <input
                        id={enumId}
                        className={`${controlClass} w-full font-mono text-xs`}
                        value={(field.enumValues ?? []).join(", ")}
                        disabled={disabled}
                        placeholder="Allowed values, comma separated"
                        onChange={(e) =>
                          update(i, {
                            enumValues: e.target.value
                              .split(",")
                              .map((v) => v.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </>
                  )}

                  <p className="eyebrow text-ink-3">
                    <span className="opacity-60">key</span> {field.key}
                  </p>
                </div>

                {/* 44px hit area around a 14px glyph — the target is the button box, not
                    the icon it draws. */}
                <button
                  type="button"
                  disabled={disabled || fields.length === 1}
                  onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
                  className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-field hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3"
                  aria-label={`Remove ${name}`}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addField}
        disabled={disabled || atMax}
        className="mt-3 w-full rounded-sm border border-dashed border-rule py-2 text-sm text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40 disabled:hover:border-rule disabled:hover:text-ink-2"
      >
        {atMax ? `Field limit reached (${MAX_FIELDS})` : "Add field"}
      </button>
    </div>
  );
}
