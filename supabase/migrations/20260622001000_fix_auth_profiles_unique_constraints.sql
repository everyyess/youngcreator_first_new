-- Match auth_profiles signup identity rules with API-level duplicate checks.
-- Plain composite unique indexes are used instead of partial indexes so they can
-- also be referenced by PostgREST/Supabase upsert on_conflict when needed.

create unique index if not exists auth_profiles_role_employee_id_key
  on public.auth_profiles(role, employee_id);

create unique index if not exists auth_profiles_role_user_id_key
  on public.auth_profiles(role, user_id);
