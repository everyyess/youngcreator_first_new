alter table if exists public.market_report_mail_sends
  add column if not exists report_date date;

create index if not exists market_report_mail_sends_scope_date_idx
  on public.market_report_mail_sends (pb_id, report_type, report_date, sent_at desc);
