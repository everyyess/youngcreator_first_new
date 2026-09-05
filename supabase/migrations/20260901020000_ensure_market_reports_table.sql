begin;

create table if not exists public.market_reports (
  market text not null,
  report_date date not null,
  generated_at timestamptz,
  data_as_of timestamptz,
  generation_status text not null default 'pending',
  generation_type text not null default 'scheduled',
  title text not null default '',
  summary text not null default '',
  sections jsonb not null default '{"bullets": []}'::jsonb,
  pb_comment text not null default '',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.market_reports
  add column if not exists market text,
  add column if not exists report_date date,
  add column if not exists generated_at timestamptz,
  add column if not exists data_as_of timestamptz,
  add column if not exists generation_status text default 'pending',
  add column if not exists generation_type text default 'scheduled',
  add column if not exists title text default '',
  add column if not exists summary text default '',
  add column if not exists sections jsonb default '{"bullets": []}'::jsonb,
  add column if not exists pb_comment text default '',
  add column if not exists error_message text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.market_reports
set
  generation_status = coalesce(generation_status, 'pending'),
  generation_type = coalesce(generation_type, 'scheduled'),
  title = coalesce(title, ''),
  summary = coalesce(summary, ''),
  sections = coalesce(sections, '{"bullets": []}'::jsonb),
  pb_comment = coalesce(pb_comment, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.market_reports
  alter column market set not null,
  alter column report_date set not null,
  alter column generation_status set default 'pending',
  alter column generation_status set not null,
  alter column generation_type set default 'scheduled',
  alter column generation_type set not null,
  alter column title set default '',
  alter column title set not null,
  alter column summary set default '',
  alter column summary set not null,
  alter column sections set default '{"bullets": []}'::jsonb,
  alter column sections set not null,
  alter column pb_comment set default '',
  alter column pb_comment set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_reports_pkey'
      and conrelid = 'public.market_reports'::regclass
  ) then
    alter table public.market_reports
      add constraint market_reports_pkey primary key (market, report_date);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_reports_market_check'
      and conrelid = 'public.market_reports'::regclass
  ) then
    alter table public.market_reports
      add constraint market_reports_market_check check (market in ('us', 'kr'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_reports_generation_status_check'
      and conrelid = 'public.market_reports'::regclass
  ) then
    alter table public.market_reports
      add constraint market_reports_generation_status_check check (generation_status in ('pending', 'success', 'failed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_reports_generation_type_check'
      and conrelid = 'public.market_reports'::regclass
  ) then
    alter table public.market_reports
      add constraint market_reports_generation_type_check check (generation_type in ('scheduled', 'manual'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_reports_pb_comment_length_check'
      and conrelid = 'public.market_reports'::regclass
  ) then
    alter table public.market_reports
      add constraint market_reports_pb_comment_length_check check (char_length(pb_comment) <= 100);
  end if;
end $$;

create index if not exists market_reports_market_report_date_idx
  on public.market_reports (market, report_date desc);

create index if not exists market_reports_generation_status_idx
  on public.market_reports (generation_status);

create or replace function public.set_market_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_market_reports_updated_at on public.market_reports;
create trigger set_market_reports_updated_at
before update on public.market_reports
for each row
execute function public.set_market_reports_updated_at();

alter table public.market_reports enable row level security;

revoke all on table public.market_reports from anon;
revoke all on table public.market_reports from authenticated;
grant select, insert, update, delete on table public.market_reports to service_role;

comment on table public.market_reports is 'Scheduled and manual market report generation results. Application API routes access this table with SUPABASE_SERVICE_ROLE_KEY.';
comment on column public.market_reports.sections is 'Normalized report payload JSON. Current code stores bullets plus indices, sectors, stocks, news, exchangeRates, and unavailable arrays when available.';

commit;
