-- 099_inv_party_item_codes.sql
-- Supplier and customer item codes: slice B of documentation/plans/MASTER_DATA_PLAN.md (Ben's decisions, 18 Nov 2026: only owners and
-- admins add, change or remove a code; one code per item per supplier or customer; "Their code" shown on purchase orders, bills and
-- invoices when a line has one).
--   * inv_party_item_codes: the code (and optional name) a supplier or customer uses for one of our items. One live code per item and
--     party; a code is unique per party (case-insensitive), so two items cannot share a supplier's code. Soft-deleted.
--   * inv_set_party_item_code / inv_remove_party_item_code: owners and admins, audited in the same transaction.
--   * inv_find_items_by_party_code(party, text): the items whose code at that party matches the text (members too; read-only).
-- The party is a supplier (pur_suppliers) or a customer (sal_customers) of the same company, checked by the functions.
-- Depends on sql/001-098. Rerun-safe. Then run sql/tests/096_inv_party_item_codes.sql.

begin;

create table if not exists public.inv_party_item_codes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  item_id    uuid not null,
  party_type text not null check (party_type in ('supplier', 'customer')),
  party_id   uuid not null,
  code       text not null check (length(trim(code)) between 1 and 64),
  name       text check (name is null or length(trim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, item_id) references public.inv_items (org_id, id)
);
create unique index if not exists inv_party_item_codes_item_uq on public.inv_party_item_codes (org_id, party_type, party_id, item_id) where deleted_at is null;
create unique index if not exists inv_party_item_codes_code_uq on public.inv_party_item_codes (org_id, party_type, party_id, upper(code)) where deleted_at is null;
create index if not exists inv_party_item_codes_org_item_idx on public.inv_party_item_codes (org_id, item_id);

drop trigger if exists inv_party_item_codes_updated_at on public.inv_party_item_codes;
create trigger inv_party_item_codes_updated_at before update on public.inv_party_item_codes for each row execute function public.set_updated_at();

alter table public.inv_party_item_codes enable row level security;
revoke all on public.inv_party_item_codes from anon, authenticated;
grant select on public.inv_party_item_codes to authenticated;
drop policy if exists inv_party_item_codes_member_read on public.inv_party_item_codes;
create policy inv_party_item_codes_member_read on public.inv_party_item_codes for select to authenticated using (public.is_org_member(org_id));

-- Not callable by users: the party's display name, or null when it is not a live supplier or customer of the company.
create or replace function public.inv__party_name(p_org uuid, p_party_type text, p_party_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p_party_type
    when 'supplier' then (select s.name from public.pur_suppliers s where s.org_id = p_org and s.id = p_party_id and s.deleted_at is null)
    when 'customer' then (select c.name from public.sal_customers c where c.org_id = p_org and c.id = p_party_id and c.deleted_at is null)
  end;
$$;
revoke all on function public.inv__party_name(uuid, text, uuid) from public, anon, authenticated;

-- Add or change a party's code for an item. Owners and admins.
create or replace function public.inv_set_party_item_code(p_item_id uuid, p_party_type text, p_party_id uuid, p_code text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); v_party text; i public.inv_items; c public.inv_party_item_codes;
  v_code text := trim(coalesce(p_code, '')); v_name text := nullif(trim(coalesce(p_name, '')), ''); v_id uuid;
begin
  if p_party_type is null or p_party_type not in ('supplier', 'customer') then raise exception 'INVALID_INPUT' using detail = 'the party is a supplier or a customer'; end if;
  if length(v_code) = 0 or length(v_code) > 64 then raise exception 'INVALID_INPUT' using detail = 'a code of 1 to 64 characters is required'; end if;
  if v_name is not null and length(v_name) > 200 then raise exception 'INVALID_INPUT' using detail = 'the name is up to 200 characters'; end if;
  select * into i from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_party := public.inv__party_name(v_org, p_party_type, p_party_id);
  if v_party is null then raise exception 'NOT_FOUND'; end if;
  select * into c from public.inv_party_item_codes
   where org_id = v_org and party_type = p_party_type and party_id = p_party_id and item_id = p_item_id and deleted_at is null for update;
  if c.id is not null and c.code = v_code and c.name is not distinct from v_name then return c.id; end if;
  begin
    if c.id is null then
      insert into public.inv_party_item_codes (org_id, item_id, party_type, party_id, code, name)
      values (v_org, p_item_id, p_party_type, p_party_id, v_code, v_name) returning id into v_id;
    else
      update public.inv_party_item_codes set code = v_code, name = v_name where id = c.id;
      v_id := c.id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = format('%s already uses that code for another item', v_party);
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), case when c.id is null then 'inventory.party_code.added' else 'inventory.party_code.changed' end, 'item', i.id::text,
          format('%s code for item %s: %s', v_party, i.sku, v_code),
          case when c.id is null then null else jsonb_build_object('code', c.code, 'name', c.name) end,
          jsonb_build_object('partyType', p_party_type, 'partyId', p_party_id, 'code', v_code, 'name', v_name));
  return v_id;
end $$;

-- Remove a party's code for an item (soft delete). Owners and admins.
create or replace function public.inv_remove_party_item_code(p_item_id uuid, p_party_type text, p_party_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin']); c public.inv_party_item_codes;
begin
  select * into c from public.inv_party_item_codes
   where org_id = v_org and party_type = p_party_type and party_id = p_party_id and item_id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.inv_party_item_codes set deleted_at = now() where id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'inventory.party_code.removed', 'item', p_item_id::text, format('%s code %s removed', initcap(p_party_type), c.code),
          jsonb_build_object('partyType', p_party_type, 'partyId', p_party_id, 'code', c.code, 'name', c.name));
end $$;

-- Items whose code at this party starts with or contains the text (case-insensitive), best matches first. Members too.
create or replace function public.inv_find_items_by_party_code(p_party_type text, p_party_id uuid, p_text text)
returns table (item_id uuid, code text, name text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.inv__guard(array['owner', 'admin', 'member', 'viewer']); v_text text := upper(trim(coalesce(p_text, '')));
begin
  if length(v_text) = 0 then return; end if;
  return query
  select c.item_id, c.code, c.name from public.inv_party_item_codes c
   where c.org_id = v_org and c.party_type = p_party_type and c.party_id = p_party_id and c.deleted_at is null
     and strpos(upper(c.code), v_text) > 0
   order by (upper(c.code) = v_text) desc, (left(upper(c.code), length(v_text)) = v_text) desc, c.code
   limit 50;
end $$;

revoke all on function public.inv_set_party_item_code(uuid, text, uuid, text, text), public.inv_remove_party_item_code(uuid, text, uuid),
  public.inv_find_items_by_party_code(text, uuid, text) from public, anon;
grant execute on function public.inv_set_party_item_code(uuid, text, uuid, text, text), public.inv_remove_party_item_code(uuid, text, uuid),
  public.inv_find_items_by_party_code(text, uuid, text) to authenticated;

commit;

-- Verification (read-only): RLS on, reads only, users can call the functions, anonymous users cannot.
select (select relrowsecurity from pg_class where oid = 'public.inv_party_item_codes'::regclass) as codes_rls_on,
       has_table_privilege('authenticated', 'public.inv_party_item_codes', 'insert') as users_insert_codes,
       has_table_privilege('authenticated', 'public.inv_party_item_codes', 'select') as users_read_codes,
       has_function_privilege('authenticated', 'public.inv_set_party_item_code(uuid, text, uuid, text, text)', 'execute') as users_set_codes,
       has_function_privilege('anon', 'public.inv_find_items_by_party_code(text, uuid, text)', 'execute') as anon_finds_codes;
