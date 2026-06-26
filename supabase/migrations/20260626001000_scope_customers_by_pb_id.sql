-- Scope customers and customer-owned state to the PB auth user that created them.
alter table public.customers
  add column if not exists pb_id uuid references auth.users(id) on delete set null;

create index if not exists customers_pb_id_idx
  on public.customers(pb_id);

update public.customers c
set pb_id = p.id
from public.auth_profiles p
where c.pb_id is null
  and c.pb_employee_id is not null
  and p.role = 'pb'
  and p.employee_id = c.pb_employee_id;

create or replace function public.lookup_customer_signup_info(p_name text, p_birth_date text)
returns table(customer_id text, pb_employee_id text)
language sql
security definer
set search_path = public
as $$
  select c.id::text, coalesce(c.pb_employee_id, pb.employee_id)::text
  from public.customers c
  left join public.auth_profiles pb
    on pb.id = c.pb_id
   and pb.role = 'pb'
  where trim(coalesce(c.name, '')) = trim(p_name)
    and regexp_replace(coalesce(c.birth_year, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_birth_date, ''), '[^0-9]', '', 'g')
  order by c.updated_at desc nulls last
  limit 1;
$$;

revoke all on function public.lookup_customer_signup_info(text, text) from public;
grant execute on function public.lookup_customer_signup_info(text, text) to anon, authenticated;

alter table public.customers enable row level security;

drop policy if exists "customers_pb_select_own" on public.customers;
drop policy if exists "customers_pb_insert_own" on public.customers;
drop policy if exists "customers_pb_update_own" on public.customers;
drop policy if exists "customers_pb_delete_own" on public.customers;
drop policy if exists "customers_customer_select_own" on public.customers;
drop policy if exists "customers_customer_update_own" on public.customers;

create policy "customers_pb_select_own"
on public.customers
for select
to authenticated
using (pb_id = auth.uid());

create policy "customers_pb_insert_own"
on public.customers
for insert
to authenticated
with check (pb_id = auth.uid());

create policy "customers_pb_update_own"
on public.customers
for update
to authenticated
using (pb_id = auth.uid())
with check (pb_id = auth.uid());

create policy "customers_pb_delete_own"
on public.customers
for delete
to authenticated
using (pb_id = auth.uid());

create policy "customers_customer_select_own"
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.auth_profiles ap
    where ap.id = auth.uid()
      and ap.role = 'customer'
      and ap.customer_id = customers.id
  )
);

create policy "customers_customer_update_own"
on public.customers
for update
to authenticated
using (
  exists (
    select 1
    from public.auth_profiles ap
    where ap.id = auth.uid()
      and ap.role = 'customer'
      and ap.customer_id = customers.id
  )
)
with check (
  exists (
    select 1
    from public.auth_profiles ap
    where ap.id = auth.uid()
      and ap.role = 'customer'
      and ap.customer_id = customers.id
  )
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rebalancing_state',
    'new_analysis_results',
    'tax_summaries',
    'product_selections'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);

      execute format('drop policy if exists "%s_pb_select_own_customer" on public.%I', table_name, table_name);
      execute format('drop policy if exists "%s_pb_insert_own_customer" on public.%I', table_name, table_name);
      execute format('drop policy if exists "%s_pb_update_own_customer" on public.%I', table_name, table_name);
      execute format('drop policy if exists "%s_pb_delete_own_customer" on public.%I', table_name, table_name);
      execute format('drop policy if exists "%s_customer_select_own" on public.%I', table_name, table_name);

      execute format(
        'create policy "%s_pb_select_own_customer" on public.%I for select to authenticated using (exists (select 1 from public.customers c where c.id = %I.customer_id and c.pb_id = auth.uid()))',
        table_name, table_name, table_name
      );
      execute format(
        'create policy "%s_pb_insert_own_customer" on public.%I for insert to authenticated with check (exists (select 1 from public.customers c where c.id = %I.customer_id and c.pb_id = auth.uid()))',
        table_name, table_name, table_name
      );
      execute format(
        'create policy "%s_pb_update_own_customer" on public.%I for update to authenticated using (exists (select 1 from public.customers c where c.id = %I.customer_id and c.pb_id = auth.uid())) with check (exists (select 1 from public.customers c where c.id = %I.customer_id and c.pb_id = auth.uid()))',
        table_name, table_name, table_name, table_name
      );
      execute format(
        'create policy "%s_pb_delete_own_customer" on public.%I for delete to authenticated using (exists (select 1 from public.customers c where c.id = %I.customer_id and c.pb_id = auth.uid()))',
        table_name, table_name, table_name
      );
      execute format(
        'create policy "%s_customer_select_own" on public.%I for select to authenticated using (exists (select 1 from public.auth_profiles ap where ap.id = auth.uid() and ap.role = ''customer'' and ap.customer_id = %I.customer_id))',
        table_name, table_name, table_name
      );
    end if;
  end loop;
end $$;
