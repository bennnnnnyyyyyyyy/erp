-- 088_vat_rates_and_owner.sql
-- VAT follow-up (Ben's decisions, 16 Nov 2026; documentation/plans/VAT_PLAN.md section 14):
--   1. No rate is added automatically: switching VAT on uses the company's default VAT rate, or is refused (VAT_RATE_MISSING) until
--      the company adds one ("nothing about rates is hardcoded", ETA plan section 7).
--   2. VAT rates can be managed without the e-invoicing module: core_save_vat_rate / core_remove_vat_rate (owner or admin, audited;
--      VAT (T1) rates only, any ETA VAT sub-type, so 0% export (V001) and exempt (V003) rates sit beside 14% and 5%). A rate that items
--      use, or that is the company default while VAT is on, cannot be removed.
--   3. Only an owner may switch VAT on or off or change the default rate (core_set_vat).
--   4. Shopify and VAT are not used together yet (Shopify prices include VAT; part 5): VAT cannot be switched on while the Shopify
--      integration is on, and while VAT is on an invoice for an order that came from Shopify is refused (VAT_SHOPIFY_NOT_SUPPORTED).
--   5. "VAT from" is chosen by the owner and defaults to the first day of the current month (a tax month is never half with VAT);
--      another day is accepted and flagged (vatFromMidMonth). Companies already registered move to the first of their month (audited).
-- Accountant review of part 2 (16 Nov):
--   6. The kind of purchase is per bill line (a bill can mix goods and a machine); the bill keeps one kind or 'mixed'.
--   7. Non-deductible VAT on a bill is part of the cost of the goods: added to each item's average cost over what is on hand (cost log
--      'purchase_vat') and posted to stock for that item, or to cost of goods sold when none is on hand; no longer to price differences.
--      On an expense it stays on the expense account (capital purchases recorded as expenses are expensed until there is a fixed-asset
--      register: VAT_PLAN.md section 14).
--   8. A deduction needs the supplier's 9-digit Egyptian tax registration number (typed, or from the supplier); it is stored as digits.
--   9. The tolerance, exactly: the printed VAT may differ from the computed VAT by the larger of 1 minor unit per line and 5 per bill.
-- Depends on sql/001-087. Rerun-safe. Run the whole file, then sql/tests/084_vat_rates_and_owner.sql.

begin;

-- ---------------------------------------------------------------- VAT rates (company data; no e-invoicing module needed)

create or replace function public.core_save_vat_rate(p_id uuid, p_sub_type text, p_rate numeric, p_label text, p_is_default boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_id uuid; v_before public.tax_rates;
begin
  if not exists (select 1 from public.eta_tax_subtypes s where s.tax_type = 'T1' and s.sub_type = p_sub_type) then
    raise exception 'INVALID_INPUT' using detail = 'choose an ETA VAT sub-type (for example V009 general, V001 export, V003 exempt)';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 or length(trim(coalesce(p_label, ''))) not between 1 and 100 then
    raise exception 'INVALID_INPUT' using detail = 'a rate from 0 to 100 and a name are required';
  end if;
  if p_id is not null then
    select * into v_before from public.tax_rates r where r.org_id = v_org and r.id = p_id and r.deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_before.tax_type <> 'T1' then raise exception 'INVALID_INPUT' using detail = 'only VAT rates are changed here'; end if;
  end if;
  if exists (select 1 from public.tax_rates r where r.org_id = v_org and lower(r.label) = lower(trim(p_label)) and r.deleted_at is null and r.id is distinct from p_id) then
    raise exception 'INVALID_INPUT' using detail = 'another rate already has that name';
  end if;
  if coalesce(p_is_default, false) then
    update public.tax_rates r set is_default = false where r.org_id = v_org and r.tax_type = 'T1' and r.is_default and r.deleted_at is null and r.id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.tax_rates (org_id, tax_type, sub_type, rate, label, is_default)
    values (v_org, 'T1', p_sub_type, p_rate, trim(p_label), coalesce(p_is_default, false)) returning id into v_id;
  else
    update public.tax_rates r set sub_type = p_sub_type, rate = p_rate, label = trim(p_label), is_default = coalesce(p_is_default, false)
     where r.id = p_id returning r.id into v_id;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), case when p_id is null then 'tax.vat_rate.created' else 'tax.vat_rate.updated' end, 'tax_rate', v_id::text,
          format('%s: VAT %s at %s%%%s (documents already issued keep their own rate)', trim(p_label), p_sub_type, trim_scale(p_rate),
                 case when coalesce(p_is_default, false) then ', default' else '' end),
          case when p_id is null then null else jsonb_build_object('sub_type', v_before.sub_type, 'rate', v_before.rate, 'label', v_before.label, 'is_default', v_before.is_default) end,
          jsonb_build_object('sub_type', p_sub_type, 'rate', p_rate, 'label', trim(p_label), 'is_default', coalesce(p_is_default, false)));
  return v_id;
end $$;

create or replace function public.core_remove_vat_rate(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.tax_rates; s jsonb;
begin
  select * into r from public.tax_rates x where x.org_id = v_org and x.id = p_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.tax_type <> 'T1' then raise exception 'INVALID_INPUT' using detail = 'only VAT rates are removed here'; end if;
  if exists (select 1 from public.inv_items i where i.org_id = v_org and i.default_tax_rate_id = r.id and i.deleted_at is null) then
    raise exception 'IN_USE' using detail = 'items still use this rate: give them another rate first';
  end if;
  select o.settings into s from public.organizations o where o.id = v_org;
  if coalesce((s ->> 'vat_registered')::boolean, false) and s ->> 'default_vat_rate_id' = r.id::text then
    raise exception 'IN_USE' using detail = 'this is the company''s default VAT rate: choose another default first';
  end if;
  update public.tax_rates x set deleted_at = now(), is_default = false where x.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'tax.vat_rate.removed', 'tax_rate', r.id::text, format('VAT rate %s (%s%%) removed', r.label, trim_scale(r.rate)));
end $$;

revoke all on function public.core_save_vat_rate(uuid, text, numeric, text, boolean), public.core_remove_vat_rate(uuid) from public, anon;
grant execute on function public.core_save_vat_rate(uuid, text, numeric, text, boolean), public.core_remove_vat_rate(uuid) to authenticated;

-- ---------------------------------------------------------------- the VAT setting: owners only, no automatic rate, not with Shopify
-- (sql/087's core_set_vat with those three changes)

drop function if exists public.core_set_vat(boolean, uuid);
-- p_vat_from: the first day VAT applies. Default: the first day of the current month (company time zone), so a tax month is never
-- half with VAT and half without (accountant review, 16 Nov). Another date is accepted but reported back (vatFromMidMonth) so the
-- screen can warn. Kept when VAT is switched off and on again unless a new one is given; part 4's opening balance uses the same date.
create or replace function public.core_set_vat(p_registered boolean, p_default_rate_id uuid default null, p_vat_from date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner']); v_reg boolean; v_rate text; r public.tax_rates;
  v_rate_id uuid := p_default_rate_id; v_from text; v_from_before text; v_today date := public.acc__local_date(v_org, now());
begin
  if p_registered is null then raise exception 'INVALID_INPUT'; end if;
  if p_vat_from is not null and (p_vat_from > v_today or p_vat_from < v_today - 3650) then
    raise exception 'INVALID_INPUT' using detail = 'the VAT start date cannot be in the future';
  end if;
  if v_rate_id is null and p_registered then
    select x.id into v_rate_id from public.tax_rates x where x.org_id = v_org and x.tax_type = 'T1' and x.is_default and x.deleted_at is null;
    if v_rate_id is null then raise exception 'VAT_RATE_MISSING' using detail = 'add the company''s VAT rate first'; end if;
  end if;
  if v_rate_id is not null then
    select * into r from public.tax_rates x where x.org_id = v_org and x.id = v_rate_id and x.deleted_at is null;
    if not found then raise exception 'NOT_FOUND' using detail = 'that tax rate does not exist'; end if;
    if r.tax_type <> 'T1' then raise exception 'INVALID_INPUT' using detail = 'the default VAT rate must be a VAT (T1) rate'; end if;
  end if;
  select coalesce((o.settings ->> 'vat_registered')::boolean, false), o.settings ->> 'default_vat_rate_id', o.settings ->> 'vat_from'
    into v_reg, v_rate, v_from_before
    from public.organizations o where o.id = v_org for update;
  v_from := coalesce(p_vat_from::text, v_from_before, case when p_registered then date_trunc('month', v_today)::date::text end);
  if v_reg = p_registered and v_rate is not distinct from v_rate_id::text and v_from is not distinct from v_from_before then
    return jsonb_build_object('vatRegistered', p_registered, 'defaultVatRateId', v_rate_id, 'vatFrom', v_from,
                              'vatFromMidMonth', v_from is not null and extract(day from v_from::date) <> 1);
  end if;
  if p_registered and not v_reg and exists (select 1 from public.core_integrations i where i.org_id = v_org and i.kind = 'shopify' and i.enabled) then
    raise exception 'VAT_SHOPIFY_NOT_SUPPORTED' using detail = 'Shopify prices include VAT, which is not supported yet: switch Shopify off first';
  end if;
  update public.organizations o
     set settings = case when v_rate_id is null then coalesce(o.settings, '{}'::jsonb) - 'default_vat_rate_id'
                         else coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('default_vat_rate_id', v_rate_id::text) end
                    || jsonb_build_object('vat_registered', p_registered)
                    || case when v_from is null then '{}'::jsonb else jsonb_build_object('vat_from', v_from) end
   where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.vat_changed', 'organization', v_org::text,
          case when p_registered then format('VAT registered from %s%s, default rate %s (%s%%)', v_from,
                                             case when extract(day from v_from::date) <> 1 then ' (not the first day of a month)' else '' end, r.label, trim_scale(r.rate))
               else 'Not VAT registered' end,
          jsonb_build_object('vat_registered', v_reg, 'default_vat_rate_id', v_rate, 'vat_from', v_from_before),
          jsonb_build_object('vat_registered', p_registered, 'default_vat_rate_id', v_rate_id, 'vat_from', v_from));
  return jsonb_build_object('vatRegistered', p_registered, 'defaultVatRateId', v_rate_id, 'vatFrom', v_from,
                            'vatFromMidMonth', v_from is not null and extract(day from v_from::date) <> 1);
end $$;
revoke all on function public.core_set_vat(boolean, uuid, date) from public, anon;
grant execute on function public.core_set_vat(boolean, uuid, date) to authenticated;

-- Companies already registered: sql/087 set "VAT from" to the day VAT was switched on; move it to the first of that month (audited).
do $$
declare o record;
begin
  for o in select id, settings ->> 'vat_from' as f from public.organizations
            where coalesce((settings ->> 'vat_registered')::boolean, false) and settings ->> 'vat_from' is not null
              and extract(day from (settings ->> 'vat_from')::date) <> 1 loop
    update public.organizations set settings = settings || jsonb_build_object('vat_from', date_trunc('month', o.f::date)::date::text) where id = o.id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
    values (o.id, null, 'organization.vat_changed', 'organization', o.id::text,
            format('VAT start moved from %s to %s, the first day of that tax month (sql/088)', o.f, date_trunc('month', o.f::date)::date),
            jsonb_build_object('vat_from', o.f), jsonb_build_object('vat_from', date_trunc('month', o.f::date)::date::text));
  end loop;
end $$;

-- ---------------------------------------------------------------- purchases: kind per bill line, VAT into stock cost, tax numbers
-- (accountant review of part 2, 16 Nov)

-- A bill can mix kinds (goods and a machine): the kind of purchase moves to each bill line. The bill keeps a summary: the one kind of
-- all its lines, or 'mixed'. Expenses keep one kind each (record a mixed receipt as two expenses).
alter table public.pur_supplier_invoice_lines add column if not exists vat_class text not null default 'local';
-- Non-deductible VAT on a stock line is part of the stock cost: cost_vat_minor is the line's share, cost_vat_to says where it went
-- ('inventory' when the item was on hand, else 'cogs').
alter table public.pur_supplier_invoice_lines add column if not exists cost_vat_minor bigint not null default 0;
alter table public.pur_supplier_invoice_lines add column if not exists cost_vat_to text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pur_supplier_invoice_lines_vat_class_chk') then
    alter table public.pur_supplier_invoice_lines add constraint pur_supplier_invoice_lines_vat_class_chk
      check (vat_class in ('local', 'capital', 'import') and cost_vat_minor >= 0 and (cost_vat_to is null or cost_vat_to in ('inventory', 'cogs'))
             and ((cost_vat_minor = 0) = (cost_vat_to is null)));
  end if;
end $$;
alter table public.pur_supplier_invoices drop constraint if exists pur_supplier_invoices_vat_chk;
alter table public.pur_supplier_invoices add constraint pur_supplier_invoices_vat_chk
  check (vat_class in ('local', 'capital', 'import', 'mixed')
         and (vat_document_ref is null or length(vat_document_ref) between 1 and 100)
         and (supplier_tax_number is null or length(supplier_tax_number) between 1 and 50)
         and (not vat_deductible or (tax_minor > 0 and vat_document_ref is not null)));
alter table public.inv_cost_log drop constraint if exists inv_cost_log_source_check;
alter table public.inv_cost_log add constraint inv_cost_log_source_check
  check (source in ('purchase_receipt', 'manual', 'customer_return', 'manual_receipt', 'revaluation', 'purchase_vat'));

-- An Egyptian tax registration number: 9 digits, dashes and spaces ignored. Returns the digits, or null when it is not one.
create or replace function public.core__eg_tax_number(p text) returns text
language sql immutable set search_path = public as $$
  select case when regexp_replace(coalesce(p, ''), '[\s-]', '', 'g') ~ '^[0-9]{9}$' then regexp_replace(p, '[\s-]', '', 'g') end
$$;
revoke all on function public.core__eg_tax_number(text) from public, anon, authenticated;

-- sql/087's fin__purchase_vat, plus: a deduction needs the supplier's 9-digit tax registration number (typed, or from the supplier);
-- the number is then stored as its 9 digits. Without a deduction any number up to 50 characters is kept (foreign suppliers).
-- p_vat_class: 'mixed' is accepted for a bill whose lines carry their own kinds.
create or replace function public.fin__purchase_vat(p_org uuid, p_vat jsonb, p_tax bigint, p_supplier uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_reg   boolean;
  v_ref   text := nullif(trim(coalesce(p_vat ->> 'documentRef', '')), '');
  v_class text := coalesce(nullif(trim(coalesce(p_vat ->> 'vatClass', '')), ''), 'local');
  v_tin   text := nullif(trim(coalesce(p_vat ->> 'supplierTaxNumber', '')), '');
  v_ded   boolean;
begin
  if p_vat is not null and jsonb_typeof(p_vat) <> 'object' then raise exception 'INVALID_INPUT' using detail = 'vat must be an object'; end if;
  if v_class not in ('local', 'capital', 'import') then raise exception 'INVALID_INPUT' using detail = 'vatClass must be local, capital or import'; end if;
  if v_ref is not null and length(v_ref) > 100 then raise exception 'INVALID_INPUT' using detail = 'the document reference is too long'; end if;
  if v_tin is null and p_supplier is not null then
    select nullif(trim(s.tax_number), '') into v_tin from public.pur_suppliers s where s.org_id = p_org and s.id = p_supplier;
  end if;
  if v_tin is not null and length(v_tin) > 50 then raise exception 'INVALID_INPUT' using detail = 'the tax number is too long'; end if;
  select coalesce((o.settings ->> 'vat_registered')::boolean, false) into v_reg from public.organizations o where o.id = p_org;
  begin v_ded := (p_vat ->> 'deductible')::boolean; exception when others then raise exception 'INVALID_INPUT' using detail = 'deductible must be true or false'; end;
  if v_ded is null then
    v_ded := v_reg and p_tax > 0 and v_ref is not null and public.core__eg_tax_number(v_tin) is not null;
  elsif v_ded then
    if not v_reg then raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'the company is not VAT registered'; end if;
    if p_tax <= 0 then raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'there is no VAT on this document'; end if;
    if v_ref is null then raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'enter the supplier''s e-invoice number (or the customs declaration for an import)'; end if;
    if public.core__eg_tax_number(v_tin) is null then
      raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'enter the supplier''s 9-digit tax registration number';
    end if;
  end if;
  if v_ded then v_tin := public.core__eg_tax_number(v_tin); end if;
  return jsonb_build_object('deductible', v_ded, 'vatClass', v_class, 'documentRef', v_ref, 'supplierTaxNumber', v_tin);
end $$;

-- sql/087's pur_record_supplier_invoice, plus: p_lines[].vatClass (the kind per line; the bill keeps one kind or 'mixed'), and
-- non-deductible VAT on stock lines added to the items' average cost (logged as 'purchase_vat'); posted to stock by acc__post_pur_invoice.
create or replace function public.pur_record_supplier_invoice(p_supplier_id uuid, p_order_id uuid, p_number text, p_invoice_date date, p_lines jsonb,
  p_vat jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.pur__guard(array['owner', 'admin']); v_order public.pur_orders%rowtype; v_invoice uuid; v_line jsonb; v_order_line uuid;
  v_qty numeric; v_cost bigint; v_item uuid; v_received numeric; v_billed numeric; v_count int := 0;
  v_default uuid; v_given text; v_rate_id uuid; v_rate numeric; v_tax bigint; v_vat jsonb; si public.pur_supplier_invoices;
  v_class text; v_classes text[] := '{}'; l record; v_left bigint; v_share bigint; v_onhand numeric; v_avg bigint; v_new bigint; v_n int;
begin
  if length(trim(coalesce(p_number, ''))) = 0 or p_invoice_date is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT'; end if;
  select * into v_order from public.pur_orders po where po.org_id = v_org and po.id = p_order_id and po.supplier_id = p_supplier_id
     and (po.status = 'received' or (po.status = 'ordered' and exists (select 1 from public.pur_order_lines x where x.org_id = v_org and x.order_id = po.id and x.received_qty > 0))) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.pur_supplier_invoices where org_id = v_org and supplier_id = p_supplier_id and lower(number) = lower(trim(p_number))) then raise exception 'DUPLICATE_INVOICE'; end if;
  select nullif(s.settings ->> 'default_vat_rate_id', '')::uuid into v_default from public.organizations s where s.id = v_org;
  insert into public.pur_supplier_invoices (org_id, number, supplier_id, order_id, invoice_date, currency, created_by)
  values (v_org, trim(p_number), p_supplier_id, p_order_id, p_invoice_date, v_order.currency, auth.uid()) returning id into v_invoice;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_order_line := (v_line ->> 'orderLineId')::uuid; v_qty := (v_line ->> 'qty')::numeric; exception when others then raise exception 'INVALID_INPUT'; end;
    if v_qty <= 0 then raise exception 'INVALID_INPUT'; end if;
    v_class := coalesce(nullif(trim(coalesce(v_line ->> 'vatClass', '')), ''), nullif(trim(coalesce(p_vat ->> 'vatClass', '')), ''), 'local');
    if v_class not in ('local', 'capital', 'import') then raise exception 'INVALID_INPUT' using detail = 'vatClass must be local, capital or import'; end if;
    select item_id, unit_cost_minor, received_qty into v_item, v_cost, v_received from public.pur_order_lines where org_id = v_org and order_id = p_order_id and id = v_order_line;
    if not found then raise exception 'INVALID_INPUT'; end if;
    select coalesce(sum(il.qty), 0) into v_billed from public.pur_supplier_invoice_lines il join public.pur_supplier_invoices inv on inv.org_id = il.org_id and inv.id = il.invoice_id where il.org_id = v_org and il.order_line_id = v_order_line;
    if v_billed + v_qty > v_received then raise exception 'BILL_QTY_EXCEEDS_RECEIVED'; end if;

    v_given := nullif(trim(coalesce(v_line ->> 'taxRateId', '')), '');
    v_rate_id := null; v_rate := 0;
    if v_given is distinct from 'exempt' then
      if v_given is not null then
        begin v_rate_id := v_given::uuid; exception when others then raise exception 'INVALID_INPUT' using detail = 'taxRateId must be a rate id or "exempt"'; end;
      else
        select t.id into v_rate_id from public.inv_items it join public.tax_rates t on t.org_id = it.org_id and t.id = it.default_tax_rate_id
         where it.org_id = v_org and it.id = v_item and t.tax_type = 'T1' and t.deleted_at is null;
        v_rate_id := coalesce(v_rate_id, v_default);
      end if;
      if v_rate_id is not null then
        select t.rate into v_rate from public.tax_rates t where t.org_id = v_org and t.id = v_rate_id and t.tax_type = 'T1' and t.deleted_at is null;
        if not found then
          if v_given is not null then raise exception 'INVALID_INPUT' using detail = 'that VAT rate does not exist'; end if;
          v_rate_id := null; v_rate := 0;
        end if;
      end if;
    end if;
    insert into public.pur_supplier_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_cost_minor, tax_rate_id, tax_rate, vat_class)
    values (v_org, v_invoice, v_order_line, v_qty, v_cost, v_rate_id, v_rate, v_class);
    if not v_class = any (v_classes) then v_classes := v_classes || v_class; end if;
    v_count := v_count + 1;
  end loop;

  select * into si from public.pur_supplier_invoices where org_id = v_org and id = v_invoice;
  -- the VAT as printed: within the larger of 1 minor unit per line and 5 minor units per bill of the computed VAT
  begin v_tax := coalesce((p_vat ->> 'taxMinor')::bigint, si.line_tax_minor); exception when others then raise exception 'INVALID_INPUT' using detail = 'taxMinor must be a whole number'; end;
  if v_tax < 0 then raise exception 'INVALID_INPUT' using detail = 'VAT cannot be negative'; end if;
  if abs(v_tax - si.line_tax_minor) > greatest(5, v_count) then
    raise exception 'VAT_MISMATCH' using detail = format('the VAT entered (%s) is too far from the VAT worked out from the lines (%s): check the rates on the lines', v_tax, si.line_tax_minor);
  end if;
  v_vat := public.fin__purchase_vat(v_org, (coalesce(p_vat, '{}'::jsonb) - 'vatClass'), v_tax, p_supplier_id);
  perform set_config('erp.doc_totals', 'on', true);
  update public.pur_supplier_invoices
     set tax_minor = v_tax, gross_minor = net_minor + v_tax, vat_deductible = (v_vat ->> 'deductible')::boolean,
         vat_class = case when cardinality(v_classes) = 1 then v_classes[1] else 'mixed' end,
         vat_document_ref = v_vat ->> 'documentRef', supplier_tax_number = v_vat ->> 'supplierTaxNumber'
   where org_id = v_org and id = v_invoice
  returning * into si;
  perform set_config('erp.doc_totals', '', true);

  -- Non-deductible VAT is part of the cost of the goods: shared over the lines by their computed VAT (the rounding difference to the
  -- line with the most VAT, or the first line when none was computed); each item's average cost rises over what is on hand.
  if not si.vat_deductible and si.tax_minor > 0 then
    v_left := si.tax_minor; v_n := 0;
    for l in select il.id, il.tax_minor, ol.item_id from public.pur_supplier_invoice_lines il join public.pur_order_lines ol on ol.org_id = il.org_id and ol.id = il.order_line_id
              where il.org_id = v_org and il.invoice_id = v_invoice order by il.tax_minor desc, il.id loop
      v_n := v_n + 1;
      v_share := case when v_n = v_count then v_left
                      when si.line_tax_minor = 0 then 0
                      else least(v_left, round(si.tax_minor::numeric * l.tax_minor / si.line_tax_minor)::bigint) end;
      if v_n = 1 and si.line_tax_minor = 0 then v_share := v_left; end if;
      v_left := v_left - v_share;
      continue when v_share = 0;
      select i.avg_cost_minor into v_avg from public.inv_items i where i.org_id = v_org and i.id = l.item_id for update;
      select coalesce(sum(b.on_hand), 0) into v_onhand from public.inv_stock_balances b where b.org_id = v_org and b.item_id = l.item_id;
      if v_onhand > 0 then
        v_new := round((v_onhand * coalesce(v_avg, 0) + v_share) / v_onhand)::bigint;
        update public.inv_items set avg_cost_minor = v_new where org_id = v_org and id = l.item_id;
        insert into public.inv_cost_log (org_id, item_id, source, ref, qty, unit_cost_minor, avg_before_minor, avg_after_minor, created_by, value_minor)
        values (v_org, l.item_id, 'purchase_vat', trim(p_number), v_onhand, v_new, coalesce(v_avg, 0), v_new, auth.uid(), v_share);
      end if;
      update public.pur_supplier_invoice_lines set cost_vat_minor = v_share, cost_vat_to = case when v_onhand > 0 then 'inventory' else 'cogs' end
       where id = l.id;
    end loop;
  end if;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'purchasing.supplier_invoice.recorded', 'supplier_invoice', v_invoice::text,
          format('Invoice %s recorded for %s minor units (%s before VAT, %s VAT%s) across %s line(s)', trim(p_number), si.gross_minor, si.net_minor, si.tax_minor,
                 case when si.tax_minor = 0 then '' when si.vat_deductible then ', deductible' else ', not deductible: added to the cost of the goods' end, v_count),
          jsonb_build_object('net_minor', si.net_minor, 'tax_minor', si.tax_minor, 'computed_tax_minor', si.line_tax_minor, 'gross_minor', si.gross_minor,
                             'vat_deductible', si.vat_deductible, 'vat_class', si.vat_class, 'vat_document_ref', si.vat_document_ref));
  return v_invoice;
end $$;

-- sql/087's acc__post_pur_invoice: non-deductible VAT now goes to stock (per item, value only) or to cost of goods sold when the item
-- was no longer on hand, instead of purchase price differences. Bills posted before keep their entries.
create or replace function public.acc__post_pur_invoice(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare si public.pur_supplier_invoices; v_received bigint; v_input bigint; v_diff bigint; v_cost_vat bigint; v_lines jsonb;
begin
  select * into si from public.pur_supplier_invoices where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(round(l.qty * ol.unit_cost_minor)), 0)::bigint, coalesce(sum(l.cost_vat_minor), 0)::bigint into v_received, v_cost_vat
    from public.pur_supplier_invoice_lines l join public.pur_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
   where l.org_id = p_org and l.invoice_id = si.id;
  if si.gross_minor = 0 and v_received = 0 then return null; end if;
  v_input := case when si.vat_deductible then si.tax_minor else 0 end;
  -- VAT neither deducted nor shared over the lines (bills written directly) stays with the price differences, as before
  v_diff := si.net_minor + (si.tax_minor - v_input - v_cost_vat) - v_received;
  v_lines := jsonb_build_array(
    jsonb_build_object('role', 'grni', 'debit', v_received, 'partyType', 'supplier', 'partyId', si.supplier_id),
    jsonb_build_object('role', 'price_variance', 'debit', greatest(v_diff, 0), 'credit', 0),
    jsonb_build_object('role', 'price_variance', 'credit', greatest(-v_diff, 0), 'debit', 0),
    jsonb_build_object('role', 'input_vat', 'debit', v_input));
  select v_lines || coalesce(jsonb_agg(jsonb_build_object('role', l.cost_vat_to, 'debit', l.cost_vat_minor, 'itemId', ol.item_id,
           'memo', 'VAT not deductible, part of the cost') order by l.id), '[]'::jsonb)
    into v_lines
    from public.pur_supplier_invoice_lines l join public.pur_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
   where l.org_id = p_org and l.invoice_id = si.id and l.cost_vat_minor > 0;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('role', 'payables', 'credit', si.gross_minor, 'partyType', 'supplier', 'partyId', si.supplier_id));
  return public.acc__post(p_org, si.invoice_date, si.currency, 'supplier_invoice', si.id::text, 'billed', 'Supplier invoice ' || si.number, v_lines, p_backfill);
end $$;
revoke all on function public.acc__post_pur_invoice(uuid, uuid, boolean) from public, anon, authenticated;
-- ---------------------------------------------------------------- invoices for Shopify orders while VAT is on
-- sql/086's sal_create_invoice with one check added after the VAT setting is read.

create or replace function public.sal_create_invoice(p_order_id uuid, p_invoice_date date, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.sal__guard(array['owner', 'admin']);
  o         public.sal_orders%rowtype;
  v_rs      text;
  v_id      uuid;
  v_no      text;
  v_n       bigint;
  e         jsonb;
  v_line    uuid;
  v_qty     numeric;
  v_ordered numeric;
  v_price   bigint;
  v_item    uuid;
  v_billed  numeric;
  v_count   int := 0;
  v_vat     boolean;
  v_default uuid;
  v_given   text;
  v_rate_id uuid;
  v_rate    numeric;
  inv       public.sal_invoices;
begin
  if p_invoice_date is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT'; end if;

  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' or o.request_id is null then raise exception 'NOT_DELIVERED'; end if;
  select r.status into v_rs from public.inv_requests r where r.org_id = v_org and r.id = o.request_id;
  if v_rs is distinct from 'issued' then raise exception 'NOT_DELIVERED'; end if;

  select coalesce((s.settings ->> 'vat_registered')::boolean, false), nullif(s.settings ->> 'default_vat_rate_id', '')::uuid
    into v_vat, v_default from public.organizations s where s.id = v_org;
  -- Shopify prices include VAT (not supported yet, VAT plan part 5): no invoice for a Shopify order while VAT is on (sql/088)
  if v_vat and exists (select 1 from public.sal_shopify_orders so where so.org_id = v_org and so.sales_order_id = o.id) then
    raise exception 'VAT_SHOPIFY_NOT_SUPPORTED' using detail = 'this order came from Shopify, whose prices include VAT: not supported yet';
  end if;

  insert into public.inv_counters (org_id, key, value) values (v_org, 'sales_invoice', 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  v_no := 'INV-' || lpad(v_n::text, 4, '0');

  insert into public.sal_invoices (org_id, number, order_id, customer_id, invoice_date, currency, created_by)
  values (v_org, v_no, o.id, o.customer_id, p_invoice_date, o.currency, auth.uid()) returning id into v_id;

  for e in select value from jsonb_array_elements(p_lines) loop
    begin v_line := (e ->> 'orderLineId')::uuid; v_qty := (e ->> 'qty')::numeric;
    exception when others then raise exception 'INVALID_INPUT'; end;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_INPUT'; end if;
    select l.qty, l.unit_price_minor, l.item_id into v_ordered, v_price, v_item from public.sal_order_lines l where l.org_id = v_org and l.order_id = o.id and l.id = v_line;
    if not found then raise exception 'INVALID_INPUT'; end if;
    select coalesce(sum(il.qty), 0) into v_billed
      from public.sal_invoice_lines il join public.sal_invoices i on i.org_id = il.org_id and i.id = il.invoice_id
     where il.org_id = v_org and il.order_line_id = v_line and i.status = 'issued' and i.id <> v_id;
    -- lines of this same invoice count too (the same order line twice in one request)
    select v_billed + coalesce(sum(il.qty), 0) into v_billed from public.sal_invoice_lines il where il.org_id = v_org and il.invoice_id = v_id and il.order_line_id = v_line;
    if v_billed + v_qty > v_ordered then raise exception 'INVOICE_QTY_EXCEEDS_DELIVERED'; end if;

    -- the line's VAT rate
    v_given := nullif(trim(coalesce(e ->> 'taxRateId', '')), '');
    v_rate_id := null; v_rate := 0;
    if not v_vat then
      if v_given is not null and v_given <> 'exempt' then raise exception 'INVALID_INPUT' using detail = 'the company is not VAT registered'; end if;
    elsif v_given = 'exempt' then
      null;
    else
      if v_given is not null then
        begin v_rate_id := v_given::uuid; exception when others then raise exception 'INVALID_INPUT' using detail = 'taxRateId must be a rate id or "exempt"'; end;
      else
        select t.id into v_rate_id from public.inv_items it join public.tax_rates t on t.org_id = it.org_id and t.id = it.default_tax_rate_id
         where it.org_id = v_org and it.id = v_item and t.tax_type = 'T1' and t.deleted_at is null;
        v_rate_id := coalesce(v_rate_id, v_default);
      end if;
      if v_rate_id is null then raise exception 'VAT_RATE_MISSING' using detail = 'choose the company''s default VAT rate in settings'; end if;
      select t.rate into v_rate from public.tax_rates t where t.org_id = v_org and t.id = v_rate_id and t.tax_type = 'T1' and t.deleted_at is null;
      if not found then
        if v_given is not null then raise exception 'INVALID_INPUT' using detail = 'that VAT rate does not exist'; end if;
        raise exception 'VAT_RATE_MISSING' using detail = 'the default VAT rate was removed: choose another in settings';
      end if;
    end if;

    insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, tax_rate_id, tax_rate)
    values (v_org, v_id, v_line, v_qty, v_price, v_rate_id, v_rate);
    v_count := v_count + 1;
  end loop;

  select * into inv from public.sal_invoices where org_id = v_org and id = v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'sales.invoice.created', 'sales_invoice', v_id::text,
          format('%s for %s: %s minor units (%s before VAT, %s VAT) across %s line(s)', v_no, o.number, inv.gross_minor, inv.net_minor, inv.tax_minor, v_count),
          jsonb_build_object('net_minor', inv.net_minor, 'tax_minor', inv.tax_minor, 'gross_minor', inv.gross_minor));
  return jsonb_build_object('id', v_id, 'number', v_no, 'netMinor', inv.net_minor, 'taxMinor', inv.tax_minor, 'grossMinor', inv.gross_minor);
end $$;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: users can manage VAT rates (true, true), anonymous cannot (false); companies registered for VAT while Shopify is on (0
-- expected; any found keep working but cannot invoice Shopify orders until one of the two is switched off).
select has_function_privilege('authenticated', 'public.core_save_vat_rate(uuid, text, numeric, text, boolean)', 'execute') as users_save_rate,
       has_function_privilege('authenticated', 'public.core_remove_vat_rate(uuid)', 'execute') as users_remove_rate,
       has_function_privilege('anon', 'public.core_save_vat_rate(uuid, text, numeric, text, boolean)', 'execute') as anon_save_rate,
       (select count(*) from public.organizations o join public.core_integrations i on i.org_id = o.id and i.kind = 'shopify' and i.enabled
         where coalesce((o.settings ->> 'vat_registered')::boolean, false)) as vat_with_shopify;
