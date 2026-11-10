-- 072_pur_delivery_notes.sql
-- The supplier's delivery note number on goods receipts (Dynamics review gap 1): what an accountant matches a supplier bill against.
--
-- Each receipt that carries a delivery note number is recorded in pur_receipts (append-only): order, the note number, who received it,
-- when, and what arrived. pur_receive_with_note(order, lines, rest_coming, note) receives through pur_receive_lines (sql/064, with every
-- rule it has, including the approval rule of sql/069) and records the note in the same transaction, so a note can never exist without
-- its receipt or the other way round. The number is optional on screen; receipts without one work as before.
-- Rerun-safe. Ends with read-only checks.

begin;

create table if not exists public.pur_receipts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  order_id         uuid not null,
  delivery_note_no text not null check (length(trim(delivery_note_no)) between 1 and 60),
  lines            jsonb not null default '[]'::jsonb,
  received_by      uuid not null references auth.users(id),
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  foreign key (org_id, order_id) references public.pur_orders(org_id, id)
);
create index if not exists pur_receipts_org_order_idx on public.pur_receipts (org_id, order_id, received_at desc);
create index if not exists pur_receipts_org_note_idx on public.pur_receipts (org_id, lower(delivery_note_no));

create or replace function public.pur__receipts_append_only() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'INVALID_STATE' using detail = 'receipts are a record and cannot be changed';
end $$;
drop trigger if exists pur_receipts_append_only on public.pur_receipts;
create trigger pur_receipts_append_only before update or delete on public.pur_receipts for each row execute function public.pur__receipts_append_only();

alter table public.pur_receipts enable row level security;
revoke all on public.pur_receipts from anon, authenticated;
grant select on public.pur_receipts to authenticated;
drop policy if exists pur_receipts_member_read on public.pur_receipts;
create policy pur_receipts_member_read on public.pur_receipts for select to authenticated using (public.is_org_member(org_id));

create or replace function public.pur_receive_with_note(p_order_id uuid, p_lines jsonb, p_rest_coming boolean, p_delivery_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.pur__guard(array['owner', 'admin', 'member']);
  v_note text := trim(coalesce(p_delivery_note, ''));
  v_res  jsonb;
  v_id   uuid;
  v_num  text;
begin
  if v_note = '' or length(v_note) > 60 then raise exception 'INVALID_INPUT' using detail = 'the delivery note number is 1 to 60 characters'; end if;
  v_res := public.pur_receive_lines(p_order_id, p_lines, p_rest_coming);
  insert into public.pur_receipts (org_id, order_id, delivery_note_no, lines, received_by)
  values (v_org, p_order_id, v_note,
          coalesce((select jsonb_agg(x) from jsonb_array_elements(p_lines) x where coalesce((x ->> 'qty')::numeric, 0) > 0), '[]'::jsonb),
          auth.uid())
  returning id into v_id;
  select number into v_num from public.pur_orders where org_id = v_org and id = p_order_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'purchasing.order.delivery_note', 'purchase_order', p_order_id::text,
          format('%s: supplier delivery note %s', v_num, v_note));
  return v_res || jsonb_build_object('receiptId', v_id);
end $$;

revoke all on function public.pur__receipts_append_only() from public, anon, authenticated;
revoke all on function public.pur_receive_with_note(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.pur_receive_with_note(uuid, jsonb, boolean, text) to authenticated;

commit;

-- Read-only verification.
select (select relrowsecurity from pg_class where oid = 'public.pur_receipts'::regclass) as rls_on,
       has_table_privilege('authenticated', 'public.pur_receipts', 'insert') as users_insert,
       has_function_privilege('anon', 'public.pur_receive_with_note(uuid, jsonb, boolean, text)', 'execute') as anon_receives;
