-- Make pre-login ID recovery tolerant of surrounding spaces and email casing.
-- These functions are called from the login page before the user is authenticated.

create or replace function public.find_pb_employee_id(p_name text, p_email text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select employee_id
  from public.auth_profiles
  where role = 'pb'
    and btrim(name) = btrim(coalesce(p_name, ''))
    and lower(btrim(email)) = lower(btrim(coalesce(p_email, '')))
  limit 1
$$;

create or replace function public.find_customer_user_id(p_name text, p_email text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select user_id
  from public.auth_profiles
  where role = 'customer'
    and btrim(name) = btrim(coalesce(p_name, ''))
    and lower(btrim(email)) = lower(btrim(coalesce(p_email, '')))
  limit 1
$$;

grant execute on function public.find_pb_employee_id(text, text) to anon, authenticated;
grant execute on function public.find_customer_user_id(text, text) to anon, authenticated;
