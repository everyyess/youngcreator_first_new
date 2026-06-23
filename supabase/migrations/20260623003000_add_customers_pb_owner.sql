-- Store which PB created/owns a customer row so customer Auth profiles can
-- inherit the assigned PB and display the PB name on Customer Home.
alter table public.customers
  add column if not exists pb_employee_id text;

create index if not exists customers_pb_employee_id_idx
  on public.customers(pb_employee_id);
