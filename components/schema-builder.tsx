"use client";

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

const inputClass =
  "w-full rounded-sm border border-rule bg-paper px-2.5 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-3 focus:border-ink focus:outline-none";

export function SchemaBuilder({
  fields,
  onChange,
  disabled,
}: {
  fields: FieldSpec[];
  onChange: (fields: FieldSpec[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<FieldSpec>) => {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const usedKeys = new Set(fields.map((f) => f.key));

  const addField = () => {
    if (fields.length >= MAX_FIELDS) return;
    onChange([...fields, blankField(fields.length)]);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-rule pb-2">
        <h2 className="text-sm font-semibold tracking-tight">Schema</h2>
        <span className="eyebrow text-ink-3">
          {fields.length} / {MAX_FIELDS} fields
        </span>
      </div>

      <ul className="divide-y divide-rule">
        {fields.map((field, i) => (
          <li key={i} className="py-3">
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <input
                    className={inputClass}
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
                  <select
                    className={`${inputClass} w-36 shrink-0`}
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

                <input
                  className={inputClass}
                  value={field.description ?? ""}
                  disabled={disabled}
                  placeholder="What counts as this field? (sent to the model verbatim)"
                  onChange={(e) => update(i, { description: e.target.value })}
                />

                {field.type === "enum" && (
                  <input
                    className={`${inputClass} font-mono text-xs`}
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
                )}

                <p className="eyebrow text-ink-3">{field.key}</p>
              </div>

              <button
                type="button"
                disabled={disabled || fields.length === 1}
                onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
                className="h-8 w-8 shrink-0 rounded-sm text-ink-3 hover:bg-field hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label={`Remove ${field.label || field.key}`}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addField}
        disabled={disabled || fields.length >= MAX_FIELDS}
        className="mt-3 w-full rounded-sm border border-dashed border-rule py-2 text-sm text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40"
      >
        Add field
      </button>
    </div>
  );
}
