-- sql/075_inv_sku_format.sql
-- A company SKU format and the next free code (walkthrough fix, Ben 10 Nov 2026: "SKU should autofill and ask me for the format
-- in the beginning"). Rerun-safe. Needs sql/001-073.
--
-- The format (a prefix and a number of digits, for example "ITM-" and 4 -> ITM-0001) lives in organizations.settings ('sku_format'),
-- the same pattern as core_set_blind_counts (sql/066). One function, for owners and admins, checks the role, saves it and writes the
-- audit row in the same transaction. inv_next_sku() is read-only: it gives the next free code for the caller's organization (the
-- highest number already used with that prefix, plus one), or null when no format is chosen. The code stays editable on the form;
-- the unique (org_id, sku) rule still decides, so two people creating at once cannot clash silently.
-- Existing items with other codes are untouched.

begin;

create or replace function public.inv_set_sku_format(p_prefix text, p_digits int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); v_prefix text := upper(trim(coalesce(p_prefix, ''))); v_before jsonb; v_after jsonb;
begin
  if v_prefix !~ '^[A-Z0-9-]{0,12}$' then raise exception 'INVALID_INPUT' using detail = 'a prefix is letters, digits and dashes, up to 12'; end if;
  if p_digits is null or p_digits < 1 or p_digits > 8 then raise exception 'INVALID_INPUT' using detail = 'digits must be 1 to 8'; end if;
  v_after := jsonb_build_object('prefix', v_prefix, 'digits', p_digits);
  select o.settings -> 'sku_format' into v_before from public.organizations o where o.id = v_org for update;
  if v_before is not distinct from v_after then return v_after; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('sku_format', v_after) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.sku_format_changed', 'organization', v_org::text,
          format('Item code format set to %s + %s digits', case when v_prefix = '' then '(no prefix)' else v_prefix end, p_digits), v_before, v_after);
  return v_after;
end $$;

-- The chosen format, or null. Read-only.
create or replace function public.inv_sku_format() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']);
begin
  return (select o.settings -> 'sku_format' from public.organizations o where o.id = v_org);
end $$;

-- The next free code in the chosen format, or null when no format is chosen. Read-only.
create or replace function public.inv_next_sku() returns text
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member']); f jsonb; v_prefix text; v_digits int; v_max numeric;
begin
  select o.settings -> 'sku_format' into f from public.organizations o where o.id = v_org;
  if f is null then return null; end if;
  v_prefix := upper(coalesce(f ->> 'prefix', ''));
  v_digits := coalesce((f ->> 'digits')::int, 4);
  -- deleted items keep their code (unique per organization), so they count too
  select max(substr(i.sku, length(v_prefix) + 1)::numeric) into v_max
    from public.inv_items i
   where i.org_id = v_org and left(i.sku, length(v_prefix)) = v_prefix
     and substr(i.sku, length(v_prefix) + 1) ~ '^[0-9]{1,15}$';
  return v_prefix || lpad((coalesce(v_max, 0) + 1)::bigint::text, v_digits, '0');
end $$;

revoke all on function public.inv_set_sku_format(text, int), public.inv_sku_format(), public.inv_next_sku() from public, anon;
grant execute on function public.inv_set_sku_format(text, int), public.inv_sku_format(), public.inv_next_sku() to authenticated;

commit;

-- Verification (read-only): signed-in users can call them (true), anonymous cannot (false).
select has_function_privilege('authenticated', 'public.inv_next_sku()', 'execute') as users_can_ask,
       has_function_privilege('authenticated', 'public.inv_set_sku_format(text, int)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.inv_next_sku()', 'execute') as anon_can_ask;
