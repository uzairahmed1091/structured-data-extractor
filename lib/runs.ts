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
 * Schema lives in supabase/migrations/ — apply with `supabase db push`, not by hand.
 * RLS is enabled with no policies, so this module must use SUPABASE_SECRET_KEY.
 *
 * Retention runs as a pg_cron job (`prune-demo-data`, daily 03:17 UTC): runs older than
 * 30 days are deleted unless they carry a sample_id, so the sample cache stays warm.
 *
 * Note we store `cells` but not the document text. The client already has the text and
 * sends it back for re-render; spans are meaningless without it, so nothing to reconstruct
 * server-side and one less pile of user content at rest.
 */

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  // Must be the secret key. The publishable key is the anon role and cannot bypass RLS,
  // so with deny-all policies every read returns empty and every write is rejected —
  // silently, because both call sites swallow the error and degrade to "no cache".
  const key = process.env.SUPABASE_SECRET_KEY;

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
  if (data?.id) return data.id;

  // ON CONFLICT DO NOTHING returns no row, so a race with an identical concurrent request
  // lands here. The winning row is the one we want; read its id back rather than
  // handing the client a null runId.
  const { data: existing } = await db
    .from("extraction_runs")
    .select("id")
    .eq("cache_key", input.cacheKey)
    .maybeSingle();

  return existing?.id ?? null;
}
