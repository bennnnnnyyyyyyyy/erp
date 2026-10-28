-- 002_core_user_lookup.sql
-- Lets the API find an existing Supabase Auth user by email, so an admin can add someone who
-- already has an account (for example a member of another organization) without sending a new
-- invite. Service role only: the browser can never call it.
--
-- Rerun-safe: `create or replace`, no tables touched. Run the whole file in the Supabase SQL
-- Editor with nothing selected, then the verification queries at the bottom.

begin;

create or replace function public.find_auth_user_id(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.find_auth_user_id(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_id(text) to service_role;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- 1. Function exists and is security definer (expect one row, prosecdef = true).
select proname, prosecdef from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'find_auth_user_id';

-- 2. Only service_role (and the owner) may execute (expect anon and authenticated = false).
select r.rolname, has_function_privilege(r.rolname, 'public.find_auth_user_id(text)', 'execute') as can_execute
from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
order by r.rolname;
