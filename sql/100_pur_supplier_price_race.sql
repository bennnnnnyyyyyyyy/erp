-- sql/100_pur_supplier_price_race.sql
-- Codex audit of 18 Nov 2026, findings 1 and 2 (documentation/planning/2026-11-18-codex-audit-findings.md), decided by Ben 18 Nov.
--   1. pur__record_supplier_price (sql/097) locked the existing row, then inserted-or-updated. When no row existed yet, an order and a
--      bill saved at the same moment could both see nothing, and the order's write could land last and replace the bill's real cost.
--      Now: a transaction lock on the supplier + item + currency key is taken before reading, so two saves for the same key run one after
--      the other; and the conflict update itself refuses an order replacing a bill.
--   2. The history row was written only when the cost changed, so a bill replacing an order at the same cost changed the recorded source
--      silently. Now a history row is written whenever anything recorded changes (cost, source kind, number or id), with before and after.
-- Same signature as sql/097 (create or replace keeps its grants: none for users; triggers call it). Needs sql/001-099. Rerun-safe.

begin;

create or replace function public.pur__record_supplier_price(p_org uuid, p_supplier uuid, p_item uuid, p_currency text, p_cost bigint,
  p_kind text, p_source uuid, p_number text) returns void
language plpgsql security definer set search_path = public as $$
declare old public.pur_supplier_prices; now_row public.pur_supplier_prices;
begin
  -- One writer at a time per supplier, item and currency, even when no row exists yet (the row lock alone cannot cover that case).
  perform pg_advisory_xact_lock(hashtextextended(format('pur_supplier_price:%s:%s:%s:%s', p_org, p_supplier, p_item, p_currency), 0));
  select * into old from public.pur_supplier_prices
   where org_id = p_org and supplier_id = p_supplier and item_id = p_item and currency = p_currency for update;
  if found and p_kind = 'order' and old.source_kind = 'bill' then return; end if;   -- an order never replaces what a bill charged
  if found and old.last_cost_minor = p_cost and old.source_kind = p_kind and old.source_id = p_source then return; end if;
  insert into public.pur_supplier_prices (org_id, supplier_id, item_id, currency, last_cost_minor, source_kind, source_id, source_number, recorded_at)
  values (p_org, p_supplier, p_item, p_currency, p_cost, p_kind, p_source, p_number, now())
  on conflict (org_id, supplier_id, item_id, currency) do update
    set last_cost_minor = excluded.last_cost_minor, source_kind = excluded.source_kind, source_id = excluded.source_id,
        source_number = excluded.source_number, recorded_at = excluded.recorded_at
    -- belt and braces: even if a row appeared after the read, an order does not overwrite a bill
    where not (excluded.source_kind = 'order' and public.pur_supplier_prices.source_kind = 'bill')
  returning * into now_row;
  if now_row.id is null then return; end if;   -- the conflict rule kept the bill: nothing changed
  if old.id is null or old.last_cost_minor is distinct from now_row.last_cost_minor or old.source_kind is distinct from now_row.source_kind
     or old.source_id is distinct from now_row.source_id or old.source_number is distinct from now_row.source_number then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
    values (p_org, auth.uid(), 'purchasing.supplier_price.recorded', 'item', p_item::text,
            format('Last cost from %s %s: %s %s', p_kind, coalesce(p_number, ''), p_cost, p_currency),
            case when old.id is null then null else jsonb_build_object('supplierId', p_supplier, 'lastCostMinor', old.last_cost_minor,
              'source', old.source_kind, 'sourceId', old.source_id, 'sourceNumber', old.source_number) end,
            jsonb_build_object('supplierId', p_supplier, 'lastCostMinor', p_cost, 'currency', p_currency, 'source', p_kind,
              'sourceId', p_source, 'sourceNumber', p_number));
  end if;
end $$;
revoke all on function public.pur__record_supplier_price(uuid, uuid, uuid, text, bigint, text, uuid, text) from public, anon, authenticated;

commit;

-- Verification (read-only): the function is the new version (it takes the advisory lock) and users still cannot call it directly.
select position('pg_advisory_xact_lock' in pg_get_functiondef('public.pur__record_supplier_price(uuid, uuid, uuid, text, bigint, text, uuid, text)'::regprocedure)) > 0 as takes_key_lock,
       has_function_privilege('authenticated', 'public.pur__record_supplier_price(uuid, uuid, uuid, text, bigint, text, uuid, text)', 'execute') as users_can_call;
