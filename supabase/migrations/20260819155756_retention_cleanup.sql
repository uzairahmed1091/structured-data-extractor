create extension if not exists pg_cron;

create or replace function public.prune_demo_data()
returns void
language sql
security definer
set search_path to 'pg_catalog, public'
as $$
  delete from public.extraction_runs
   where created_at < now() - interval '30 days'
     and not cacheable;

  delete from public.rate_limit_hits
   where window_start < now() - interval '2 days';
$$;

revoke all on function public.prune_demo_data() from public, anon, authenticated;

select cron.schedule(
  'prune-demo-data',
  '17 3 * * *',
  $$select public.prune_demo_data();$$
);
