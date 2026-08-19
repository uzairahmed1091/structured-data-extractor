drop table if exists public.extraction_runs;

-- Extraction runs: one row per extraction attempt.
create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- input
  source_type   text  not null check (source_type in ('text','pdf','sample')),
  source_label  text,                       -- filename or sample doc slug
  source_text   text  not null,             -- normalized text the citations index into
  source_hash   text  not null,             -- sha256(source_text)
  schema_json   jsonb not null,             -- user-defined field list
  schema_hash   text  not null,             -- sha256(canonicalized schema_json)

  -- output: { fields: [{ name, type, value, citation: { start, end, quote } | null }] }
  result_json   jsonb,
  status        text  not null default 'ok' check (status in ('ok','error')),
  error_message text,

  -- meta
  model              text not null,
  byok               boolean not null default false,   -- user supplied their own API key
  cacheable          boolean not null default false,   -- only sample docs on the demo key
  prompt_tokens      integer,
  completion_tokens  integer,
  latency_ms         integer,
  ip_hash            text                              -- sha256(ip + server salt), never raw IP
);

comment on table public.extraction_runs is
  'One row per extraction attempt. Written server-side with the secret key only; RLS denies all client access.';

-- Cache lookup for preloaded sample documents: same source + same schema = reuse the result.
create unique index extraction_runs_cache_key
  on public.extraction_runs (source_hash, schema_hash)
  where cacheable and status = 'ok';

create index extraction_runs_created_at_idx on public.extraction_runs (created_at desc);
create index extraction_runs_ip_hash_idx     on public.extraction_runs (ip_hash, created_at desc);

-- Fixed-window rate limiting by hashed IP.
create table public.rate_limit_hits (
  ip_hash      text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (ip_hash, window_start)
);

comment on table public.rate_limit_hits is
  'Fixed-window request counters keyed by hashed IP. Server-side only.';

-- Atomically record a hit and return the running count for the current window.
create function public.hit_rate_limit(p_ip_hash text, p_window_seconds integer default 3600)
returns integer
language plpgsql
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_hits (ip_hash, window_start, count)
  values (p_ip_hash, v_window, 1)
  on conflict (ip_hash, window_start)
    do update set count = public.rate_limit_hits.count + 1
  returning count into v_count;

  return v_count;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer) from public, anon, authenticated;

-- RLS: enabled with zero policies = deny all for anon/authenticated.
-- The server route uses the secret key (service_role), which bypasses RLS.
alter table public.extraction_runs  enable row level security;
alter table public.rate_limit_hits  enable row level security;

revoke all on public.extraction_runs from anon, authenticated;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Silence the advisor: this helper is an event-trigger function, not a REST endpoint.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
