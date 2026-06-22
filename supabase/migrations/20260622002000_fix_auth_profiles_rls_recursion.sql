-- Avoid RLS recursion when authenticated users read their auth_profiles row.
-- The old PB customer-read policy queried auth_profiles from inside an
-- auth_profiles policy, which makes PostgreSQL recurse while evaluating SELECT.

create or replace function public.current_pb_employee_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select employee_id
  from public.auth_profiles
  where id = auth.uid()
    and role = 'pb'
  limit 1
$$;

revoke all on function public.current_pb_employee_id() from public;
grant execute on function public.current_pb_employee_id() to authenticated;

drop policy if exists "auth_profiles_pb_select_assigned_customers" on public.auth_profiles;

create policy "auth_profiles_pb_select_assigned_customers"
on public.auth_profiles
for select
to authenticated
using (
  role = 'customer'
  and pb_employee_id = public.current_pb_employee_id()
);
