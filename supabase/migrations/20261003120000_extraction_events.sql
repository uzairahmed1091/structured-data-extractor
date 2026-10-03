-- One row per extraction attempt, including cache hits and blocked requests.
-- extraction_runs cannot answer "did anyone use the demo": a cached sample returns before
-- anything is saved, so sample traffic leaves no trace there. This table holds counts
-- only — no document text, no schema, no values, no IP.
create table public.extraction_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  source      text    not null,                -- a sample id, or 'own' for a visitor's document
  outcome     text    not null,                -- 'ok' | 'cached' | an error code
  field_count integer not null,
  byo_key     boolean not null default false,
  owner       boolean not null default false   -- the site owner's own testing, excluded from reads
);

comment on table public.extraction_events is
  'Anonymous usage counts for the demo: one row per extraction attempt. No content and no visitor identifiers. Server-side only; RLS denies all client access.';

create index extraction_events_created_at_idx on public.extraction_events (created_at desc);

alter table public.extraction_events enable row level security;
revoke all on public.extraction_events from anon, authenticated;
