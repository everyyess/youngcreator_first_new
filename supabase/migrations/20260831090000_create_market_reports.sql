create table if not exists public.market_reports (
  market text not null check (market in ('us', 'kr')),
  report_date date not null,
  generated_at timestamptz,
  data_as_of timestamptz,
  generation_status text not null default 'pending' check (generation_status in ('pending', 'success', 'failed')),
  generation_type text not null default 'scheduled' check (generation_type in ('scheduled', 'manual')),
  title text not null default '',
  summary text not null default '',
  sections jsonb not null default '{}'::jsonb,
  pb_comment text not null default '',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint market_reports_pkey primary key (market, report_date)
);

create index if not exists market_reports_market_report_date_idx
  on public.market_reports(market, report_date desc);

alter table public.market_reports enable row level security;

-- Application API routes should read/write this table with SUPABASE_SERVICE_ROLE_KEY.
-- No anon/authenticated write policy is opened for scheduled report generation.

