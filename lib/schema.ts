import { z } from "zod";

/**
 * Single source of truth for a user-defined extraction schema.
 *
 * A FieldSpec[] compiles to two artifacts:
 *   1. buildResponseFormat()  -> JSON Schema for OpenAI structured outputs (strict mode)
 *   2. buildValueSchema()     -> Zod validators for the response and the exported payload
 *
 * We hand-write the JSON Schema instead of running Zod through zod-to-json-schema because
 * strict mode has non-negotiable requirements (every object needs additionalProperties:false,
 * every property must be in `required`, optionality is expressed only as a nullable union,
 * and `format`/`pattern`/`minLength` are rejected). Generating it directly is less code than
 * post-processing a generated schema into compliance.
 */

export const FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "string_list",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const MAX_FIELDS = 25;

export const fieldSpecSchema = z
  .object({
    // Becomes a JSON key and a column id. Keep it boring.
    key: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]{0,47}$/,
        "key must be snake_case, start with a letter, max 48 chars",
      ),
    label: z.string().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    // Fed to the model verbatim. This is the highest-leverage field in the whole app.
    description: z.string().max(300).default(""),
    enumValues: z.array(z.string().min(1).max(60)).min(2).max(20).optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.type === "enum" && (!spec.enumValues || spec.enumValues.length < 2)) {
      ctx.addIssue({
        code: "custom",
        path: ["enumValues"],
        message: "enum fields need at least 2 allowed values",
      });
    }
    if (spec.type === "enum" && spec.enumValues) {
      const seen = new Set(spec.enumValues.map((v) => v.toLowerCase()));
      if (seen.size !== spec.enumValues.length) {
        ctx.addIssue({
          code: "custom",
          path: ["enumValues"],
          message: "enum values must be unique (case-insensitive)",
        });
      }
    }
  });

export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const schemaSpecSchema = z
  .array(fieldSpecSchema)
  .min(1, "define at least one field")
  .max(MAX_FIELDS, `max ${MAX_FIELDS} fields on the demo path`)
  .superRefine((specs, ctx) => {
    const seen = new Set<string>();
    for (const [i, s] of specs.entries()) {
      if (seen.has(s.key)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "key"],
          message: `duplicate field key "${s.key}"`,
        });
      }
      seen.add(s.key);
    }
  });

/* -------------------------------------------------------------------------- */
/* JSON Schema (OpenAI structured outputs, strict: true)                       */
/* -------------------------------------------------------------------------- */

type JsonSchema = Record<string, unknown>;

const TYPE_HINTS: Record<FieldType, string> = {
  string: "Plain text as it appears in the document.",
  number: "A number only — no currency symbols, thousands separators, or units.",
  boolean: "true or false.",
  date: "An ISO 8601 calendar date, YYYY-MM-DD.",
  enum: "Exactly one of the allowed values.",
  string_list: "An array of short strings, one per distinct item.",
};

function describe(spec: FieldSpec): string {
  const parts = [spec.label, spec.description?.trim(), TYPE_HINTS[spec.type]].filter(
    Boolean,
  ) as string[];
  return `${parts.join(" — ")} Use null if the document does not state this.`;
}

function valueJsonSchema(spec: FieldSpec): JsonSchema {
  const description = describe(spec);
  switch (spec.type) {
    case "string":
    case "date":
      return { type: ["string", "null"], description };
    case "number":
      return { type: ["number", "null"], description };
    case "boolean":
      return { type: ["boolean", "null"], description };
    case "enum":
      // Strict mode expresses "nullable enum" by putting null in the enum list too.
      return {
        type: ["string", "null"],
        enum: [...(spec.enumValues ?? []), null],
        description,
      };
    case "string_list":
      return {
        type: ["array", "null"],
        items: { type: "string" },
        description,
      };
  }
}

const QUOTE_DESCRIPTION =
  "The exact contiguous substring of the document that supports `value`, copied character for character. " +
  "Must be null if and only if `value` is null.";

/**
 * Every cell is {value, quote} rather than a bare value. This is what makes the
 * citation feature structural instead of a bolt-on: the model cannot return a value
 * without also committing to where it came from.
 */
export function buildResponseFormat(specs: FieldSpec[], name = "extraction") {
  const properties: Record<string, JsonSchema> = {};

  for (const spec of specs) {
    properties[spec.key] = {
      type: "object",
      properties: {
        value: valueJsonSchema(spec),
        quote: { type: ["string", "null"], description: QUOTE_DESCRIPTION },
      },
      required: ["value", "quote"],
      additionalProperties: false,
    };
  }

  return {
    type: "json_schema" as const,
    json_schema: {
      name,
      strict: true,
      schema: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            properties,
            required: specs.map((s) => s.key),
            additionalProperties: false,
          },
        },
        required: ["fields"],
        additionalProperties: false,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Zod validators                                                              */
/* -------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v: string): boolean {
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/** Strict per-field validator, applied with safeParse so one bad cell can't nuke the run. */
export function buildValueSchema(spec: FieldSpec): z.ZodTypeAny {
  switch (spec.type) {
    case "string":
      return z.string().trim().min(1);
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "date":
      return z.string().regex(ISO_DATE).refine(isRealDate, "not a real calendar date");
    case "enum":
      return z.enum(spec.enumValues as [string, ...string[]]);
    case "string_list":
      return z.array(z.string().trim().min(1)).min(1);
  }
}

/**
 * Deliberately loose. Structured outputs makes the shape near-certain, but a demo that
 * runs unattended for months should degrade one cell at a time, not 500 the whole request
 * because the model emitted a number where a string was declared.
 */
export const cellEnvelopeSchema = z.object({
  value: z.unknown(),
  quote: z.union([z.string(), z.null()]).catch(null),
});

export const extractionEnvelopeSchema = z.object({
  fields: z.record(z.string(), cellEnvelopeSchema),
});

/** Validates the flat {key: value|null} payload used by the JSON/CSV export. */
export function buildOutputSchema(specs: FieldSpec[]) {
  return z.object(
    Object.fromEntries(
      specs.map((s) => [s.key, buildValueSchema(s).nullable()]),
    ) as Record<string, z.ZodTypeAny>,
  );
}

/** Stable serialization used for cache keys. Order- and formatting-independent. */
export function canonicalizeSchema(specs: FieldSpec[]): string {
  return JSON.stringify(
    specs
      .map((s) => ({
        k: s.key,
        t: s.type,
        d: (s.description ?? "").trim(),
        e: s.enumValues ?? null,
      }))
      .sort((a, b) => a.k.localeCompare(b.k)),
  );
}
