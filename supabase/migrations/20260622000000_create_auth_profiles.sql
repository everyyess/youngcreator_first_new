-- Auth profile metadata for PB / customer role separation.
-- Passwords are handled by Supabase Auth only. This table stores role and lookup metadata.

create table if not exists public.auth_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('pb', 'customer')),
  name text not null default '',
  email text not null default '',
  employee_id text,
  user_id text,
  customer_id text references public.customers(id) on delete cascade,
  birth_date text,
  pb_employee_id text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint auth_profiles_pb_required
    check (role <> 'pb' or employee_id is not null),
  constraint auth_profiles_customer_required
    check (role <> 'customer' or (user_id is not null and customer_id is not null))
);

create unique index if not exists auth_profiles_pb_employee_id_key
  on public.auth_profiles(employee_id)
  where role = 'pb';

create unique index if not exists auth_profiles_customer_user_id_key
  on public.auth_profiles(user_id)
  where role = 'customer';

create index if not exists auth_profiles_customer_id_idx
  on public.auth_profiles(customer_id)
  where role = 'customer';

create index if not exists auth_profiles_pb_employee_id_idx
  on public.auth_profiles(pb_employee_id)
  where role = 'customer';

alter table public.auth_profiles enable row level security;

-- Public lookup functions used before sign-in. They return only the one field needed
-- for Supabase Auth sign-in / account recovery screens, instead of opening table SELECT.
create or replace function public.lookup_pb_login_email(p_employee_id text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email
  from public.auth_profiles
  where role = 'pb'
    and employee_id = p_employee_id
  limit 1
$$;

create or replace function public.lookup_customer_login_email(p_user_id text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email
  from public.auth_profiles
  where role = 'customer'
    and user_id = p_user_id
  limit 1
$$;

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
    and name = p_name
    and email = p_email
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
    and name = p_name
    and email = p_email
  limit 1
$$;

grant execute on function public.lookup_pb_login_email(text) to anon, authenticated;
grant execute on function public.lookup_customer_login_email(text) to anon, authenticated;
grant execute on function public.find_pb_employee_id(text, text) to anon, authenticated;
grant execute on function public.find_customer_user_id(text, text) to anon, authenticated;

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

drop policy if exists "auth_profiles_select_own" on public.auth_profiles;
create policy "auth_profiles_select_own"
on public.auth_profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "auth_profiles_insert_own" on public.auth_profiles;
create policy "auth_profiles_insert_own"
on public.auth_profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "auth_profiles_update_own" on public.auth_profiles;
create policy "auth_profiles_update_own"
on public.auth_profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- PB can read profiles for customers assigned to their employee_id.
drop policy if exists "auth_profiles_pb_select_assigned_customers" on public.auth_profiles;
create policy "auth_profiles_pb_select_assigned_customers"
on public.auth_profiles
for select
to authenticated
using (
  role = 'customer'
  and pb_employee_id = public.current_pb_employee_id()
);

-- Service-role operations, including password reset lookup and admin maintenance,
-- bypass RLS by design through the Supabase service role key.
