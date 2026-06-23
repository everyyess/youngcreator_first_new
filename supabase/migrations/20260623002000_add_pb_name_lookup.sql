-- Let a signed-in customer show the assigned PB name without opening
-- auth_profiles SELECT access to other users' rows.
create or replace function public.lookup_pb_name_by_employee_id(p_employee_id text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select name
  from public.auth_profiles
  where role = 'pb'
    and employee_id = btrim(p_employee_id)
  limit 1
$$;

revoke all on function public.lookup_pb_name_by_employee_id(text) from public;
grant execute on function public.lookup_pb_name_by_employee_id(text) to authenticated;
