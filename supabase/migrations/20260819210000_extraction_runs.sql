-- Persistence and the read-through cache are the same table. A run is content-addressed
-- by (prompt version, model, document text, schema), so the preloaded sample documents
-- become cached the moment the first visitor runs them — no warm-up job, and no cache
-- invalidation beyond bumping PROMPT_VERSION in lib/extract.ts.

drop table if exists public.extraction_runs;

create table public.extraction_runs (
  id          uuid primary key default gen_random_uuid(),
  -- sha256(prompt_version, model, document_text, canonicalized_schema)
  cache_key   text not null unique,
  model       text not null,
  -- Set when the run came from a preloaded sample. Also the retention exemption:
  -- sample rows are the warm cache and are never pruned.
  sample_id   text,
  byo_key     boolean not null default false,
  field_count integer not null,
  doc_chars   integer not null,
  -- Cell[] from lib/extract.ts: { key, value, quote, span, status, rejected? }
  cells       jsonb not null,
  schema_spec jsonb not null,
  usage       jsonb,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

comment on table public.extraction_runs is
  'One row per extraction. Doubles as the read-through cache, keyed by cache_key. Document text is intentionally not stored — the client holds it and sends it back for re-render. Server-side only: RLS denies all client access.';

create index extraction_runs_created_at_idx on public.extraction_runs (created_at desc);
create index extraction_runs_sample_id_idx  on public.extraction_runs (sample_id)
  where sample_id is not null;

-- RLS enabled with zero policies = deny all for anon/authenticated.
-- The API route connects with SUPABASE_SECRET_KEY, which bypasses RLS.
alter table public.extraction_runs enable row level security;
revoke all on public.extraction_runs from anon, authenticated;

-- Retention: a public demo shouldn't accumulate strangers' runs forever.
-- Sample runs are exempt so the cache stays warm across months.
create extension if not exists pg_cron;

create or replace function public.prune_demo_data()
returns void
language sql
security definer
set search_path to 'pg_catalog, public'
as $$
  delete from public.extraction_runs
   where created_at < now() - interval '30 days'
     and sample_id is null;
$$;

revoke all on function public.prune_demo_data() from public, anon, authenticated;

select cron.schedule(
  'prune-demo-data',
  '17 3 * * *',
  $$select public.prune_demo_data();$$
);

-- public.rls_auto_enable() is an event-trigger helper that auto-enables RLS on new
-- public tables. It is not a REST endpoint; revoke EXECUTE to clear the security advisor.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
