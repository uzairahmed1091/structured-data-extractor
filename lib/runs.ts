import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { canonicalizeSchema, type FieldSpec } from "./schema";
import { PROMPT_VERSION, type Cell } from "./extract";

/**
 * Persistence and cache are the same table. A run is content-addressed by
 * (prompt version, model, document text, schema), so the preloaded sample documents
 * are cached for free the moment the first visitor runs them — no separate warm-up job,
 * no cache invalidation logic beyond bumping PROMPT_VERSION.
 *
 * Schema (run once in the Supabase SQL editor):
 *
 *   create table extraction_runs (
 *     id           uuid primary key default gen_random_uuid(),
 *     cache_key    text not null unique,
 *     model        text not null,
 *     sample_id    text,
 *     byo_key      boolean not null default false,
 *     field_count  int not null,
 *     doc_chars    int not null,
 *     cells        jsonb not null,
 *     schema_spec  jsonb not null,
 *     usage        jsonb,
 *     duration_ms  int,
 *     created_at   timestamptz not null default now()
 *   );
 *   create index on extraction_runs (created_at desc);
 *   alter table extraction_runs enable row level security;
 *   -- no policies: service role only. The route is the sole reader/writer.
 *
 * Retention, so a public demo doesn't accumulate strangers' pasted text forever
 * (pg_cron, or a Vercel cron hitting a small route):
 *   delete from extraction_runs where created_at < now() - interval '30 days';
 *
 * Note we store `cells` but not the document text. The client already has the text and
 * sends it back for re-render; spans are meaningless without it, so nothing to reconstruct
 * server-side and one less pile of user content at rest.
 */

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function computeCacheKey(input: {
  model: string;
  documentText: string;
  fields: FieldSpec[];
}): string {
  return createHash("sha256")
    .update(PROMPT_VERSION)
    .update("\u0000")
    .update(input.model)
    .update("\u0000")
    .update(input.documentText)
    .update("\u0000")
    .update(canonicalizeSchema(input.fields))
    .digest("hex");
}

export type CachedRun = { id: string; cells: Cell[]; model: string };

export async function getCachedRun(cacheKey: string): Promise<CachedRun | null> {
  const db = supabase();
  if (!db) return null;

  const { data, error } = await db
    .from("extraction_runs")
    .select("id, cells, model")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, cells: data.cells as Cell[], model: data.model };
}

export async function saveRun(input: {
  cacheKey: string;
  model: string;
  sampleId?: string;
  byoKey: boolean;
  fields: FieldSpec[];
  docChars: number;
  cells: Cell[];
  usage: { promptTokens: number; completionTokens: number } | null;
  durationMs: number;
}): Promise<string | null> {
  const db = supabase();
  if (!db) return null;

  const { data, error } = await db
    .from("extraction_runs")
    .upsert(
      {
        cache_key: input.cacheKey,
        model: input.model,
        sample_id: input.sampleId ?? null,
        byo_key: input.byoKey,
        field_count: input.fields.length,
        doc_chars: input.docChars,
        cells: input.cells,
        schema_spec: input.fields,
        usage: input.usage,
        duration_ms: input.durationMs,
      },
      { onConflict: "cache_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("saveRun failed", error.message);
    return null;
  }
  return data?.id ?? null;
}
