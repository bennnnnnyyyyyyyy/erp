-- 087_vat_on_purchases.sql
-- VAT part 2 (documentation/plans/VAT_PLAN.md section 10 item 2, with the accountant review, section 13): input VAT on supplier bills
-- and on expenses. ADR-0005.
--   * Supplier bill lines get tax_rate_id, tax_rate (copied), net_minor, tax_minor, computed by a BEFORE INSERT trigger (net =
--     round(qty x unit cost), tax = round(net x rate / 100)). Bills get net_minor, line_tax_minor (the sum of the computed line VAT),
--     tax_minor (the VAT AS PRINTED on the supplier's invoice) and gross_minor = net + tax. The printed VAT may differ from the computed
--     one by at most 1 minor unit per line (at least 5): the supplier's document is the one the ETA holds.
--   * Expenses get net_minor, tax_minor (as printed), tax_rate_id / tax_rate (optional, for the tolerance check); amount_minor stays the
--     gross (net + VAT), so payments are unchanged.
--   * Both get vat_deductible, vat_class ('local' goods and services, 'capital' asset, 'import'), vat_document_ref (the supplier's
--     e-invoice number, or the customs declaration for an import) and supplier_tax_number (copied from the supplier, or typed for an
--     import). Deductible VAT needs the company to be VAT registered and a document reference (Decree 188/2023: only e-invoices support
--     a deduction); it defaults to that. Non-deductible VAT is cost.
--   * Posting: bill Dr GRNI (received cost) / Dr or Cr price differences (net, plus non-deductible VAT, less received cost) / Dr input
--     VAT (deductible VAT) / Cr suppliers gross. Expense Dr expense (net plus non-deductible VAT) / Dr input VAT / Cr gross.
--   * settings.vat_from: the date VAT was first switched on (core_set_vat), so the VAT summary (part 3) can flag earlier periods.
--   * What is owed on a bill is its gross (overpayment check, owner insights).
-- Existing bills and expenses: VAT 0, not deductible, class 'local'. Nothing posted changes. Depends on sql/001-086. Rerun-safe.
-- Run the whole file, then sql/tests/083_vat_on_purchases.sql.

begin;

-- ---------------------------------------------------------------- columns

alter table public.pur_supplier_invoice_lines add column if not exists tax_rate_id uuid;
alter table public.pur_supplier_invoice_lines add column if not exists tax_rate numeric(8, 5) not null default 0;
alter table public.pur_supplier_invoice_lines add column if not exists net_minor bigint;
alter table public.pur_supplier_invoice_lines add column if not exists tax_minor bigint not null default 0;

alter table public.pur_supplier_invoices add column if not exists net_minor bigint not null default 0;
alter table public.pur_supplier_invoices add column if not exists line_tax_minor bigint not null default 0;
alter table public.pur_supplier_invoices add column if not exists tax_minor bigint not null default 0;
alter table public.pur_supplier_invoices add column if not exists gross_minor bigint not null default 0;

alter table public.fin_expenses add column if not exists net_minor bigint;
alter table public.fin_expenses add column if not exists tax_minor bigint not null default 0;
alter table public.fin_expenses add column if not exists tax_rate_id uuid;
alter table public.fin_expenses add column if not exists tax_rate numeric(8, 5) not null default 0;

do $$
declare t text;
begin
  foreach t in array array['pur_supplier_invoices', 'fin_expenses'] loop
    execute format('alter table public.%I add column if not exists vat_deductible boolean not null default false', t);
    execute format('alter table public.%I add column if not exists vat_class text not null default ''local''', t);
    execute format('alter table public.%I add column if not exists vat_document_ref text', t);
    execute format('alter table public.%I add column if not exists supplier_tax_number text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_vat_chk') then
      execute format('alter table public.%I add constraint %I check (vat_class in (''local'', ''capital'', ''import'')'
                     ' and (vat_document_ref is null or length(vat_document_ref) between 1 and 100)'
                     ' and (supplier_tax_number is null or length(supplier_tax_number) between 1 and 50)'
                     ' and (not vat_deductible or (tax_minor > 0 and vat_document_ref is not null)))', t, t || '_vat_chk');
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'pur_supplier_invoice_lines_tax_rate_fk') then
    alter table public.pur_supplier_invoice_lines add constraint pur_supplier_invoice_lines_tax_rate_fk foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_expenses_tax_rate_fk') then
    alter table public.fin_expenses add constraint fin_expenses_tax_rate_fk foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_supplier_invoice_lines_tax_chk') then
    alter table public.pur_supplier_invoice_lines add constraint pur_supplier_invoice_lines_tax_chk check (tax_rate between 0 and 100 and tax_minor >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------- the line maths and the totals

create or replace function public.pur__line_tax() returns trigger
language plpgsql set search_path = public as $$
begin
  new.net_minor := round(new.qty * new.unit_cost_minor)::bigint;
  new.tax_rate := coalesce(new.tax_rate, 0);
  new.tax_minor := round(new.net_minor * new.tax_rate / 100)::bigint;
  return new;
end $$;
revoke all on function public.pur__line_tax() from public, anon, authenticated;
drop trigger if exists pur_supplier_invoice_lines_tax on public.pur_supplier_invoice_lines;
create trigger pur_supplier_invoice_lines_tax before insert on public.pur_supplier_invoice_lines for each row execute function public.pur__line_tax();

-- Each new line adds its net and computed VAT to the bill. The printed VAT (tax_minor) is set once by pur_record_supplier_invoice;
-- a bill written directly (older code, fixtures) keeps VAT 0 and gross = net.
create or replace function public.pur__bill_line_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('erp.doc_totals', 'on', true);
  update public.pur_supplier_invoices
     set net_minor = net_minor + new.net_minor, line_tax_minor = line_tax_minor + new.tax_minor, gross_minor = net_minor + new.net_minor + tax_minor
   where org_id = new.org_id and id = new.invoice_id;
  perform set_config('erp.doc_totals', '', true);
  return null;
end $$;
revoke all on function public.pur__bill_line_rollup() from public, anon, authenticated;

create or replace function public.pur__bill_totals_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.net_minor, new.line_tax_minor, new.tax_minor, new.gross_minor, new.vat_deductible, new.vat_class, new.vat_document_ref, new.supplier_tax_number)
     is distinct from (old.net_minor, old.line_tax_minor, old.tax_minor, old.gross_minor, old.vat_deductible, old.vat_class, old.vat_document_ref, old.supplier_tax_number)
     and current_setting('erp.doc_totals', true) is distinct from 'on' then
    raise exception 'INVALID_STATE' using detail = 'a bill''s amounts and VAT cannot be edited';
  end if;
  return new;
end $$;
revoke all on function public.pur__bill_totals_guard() from public, anon, authenticated;

-- An expense written without its net (older code, fixtures, sql/068's bank charges) has no VAT: net = amount.
create or replace function public.fin__expense_vat_default() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.net_minor is null then new.net_minor := new.amount_minor - coalesce(new.tax_minor, 0); end if;
  return new;
end $$;
revoke all on function public.fin__expense_vat_default() from public, anon, authenticated;
drop trigger if exists fin_expenses_vat_default on public.fin_expenses;
create trigger fin_expenses_vat_default before insert on public.fin_expenses for each row execute function public.fin__expense_vat_default();

create or replace function public.fin__expense_vat_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.amount_minor, new.net_minor, new.tax_minor, new.tax_rate_id, new.tax_rate, new.vat_deductible, new.vat_class, new.vat_document_ref, new.supplier_tax_number)
     is distinct from (old.amount_minor, old.net_minor, old.tax_minor, old.tax_rate_id, old.tax_rate, old.vat_deductible, old.vat_class, old.vat_document_ref, old.supplier_tax_number)
     and current_setting('erp.doc_totals', true) is distinct from 'on' then
    raise exception 'INVALID_STATE' using detail = 'an expense''s amount and VAT cannot be edited: void it and record it again';
  end if;
  return new;
end $$;
revoke all on function public.fin__expense_vat_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- backfill (once; a rerun changes nothing)

select set_config('erp.doc_totals', 'on', true);
update public.pur_supplier_invoice_lines set net_minor = round(qty * unit_cost_minor)::bigint where net_minor is null;
alter table public.pur_supplier_invoice_lines alter column net_minor set not null;
update public.pur_supplier_invoices i
   set net_minor = s.net, line_tax_minor = s.tax, gross_minor = s.net + i.tax_minor
  from (select l.org_id, l.invoice_id, sum(l.net_minor)::bigint as net, sum(l.tax_minor)::bigint as tax
          from public.pur_supplier_invoice_lines l group by l.org_id, l.invoice_id) s
 where s.org_id = i.org_id and s.invoice_id = i.id
   and (i.net_minor, i.line_tax_minor, i.gross_minor) is distinct from (s.net, s.tax, s.net + i.tax_minor);
update public.fin_expenses set net_minor = amount_minor - tax_minor where net_minor is null;
alter table public.fin_expenses alter column net_minor set not null;
select set_config('erp.doc_totals', '', true);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pur_supplier_invoices_totals_chk') then
    alter table public.pur_supplier_invoices add constraint pur_supplier_invoices_totals_chk
      check (net_minor >= 0 and line_tax_minor >= 0 and tax_minor >= 0 and gross_minor = net_minor + tax_minor);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_expenses_totals_chk') then
    alter table public.fin_expenses add constraint fin_expenses_totals_chk
      check (net_minor >= 0 and tax_minor >= 0 and amount_minor = net_minor + tax_minor and tax_rate between 0 and 100);
  end if;
end $$;

drop trigger if exists pur_supplier_invoice_lines_rollup on public.pur_supplier_invoice_lines;
create trigger pur_supplier_invoice_lines_rollup after insert on public.pur_supplier_invoice_lines for each row execute function public.pur__bill_line_rollup();
drop trigger if exists pur_supplier_invoices_totals_guard on public.pur_supplier_invoices;
create trigger pur_supplier_invoices_totals_guard before update on public.pur_supplier_invoices for each row execute function public.pur__bill_totals_guard();
drop trigger if exists fin_expenses_vat_guard on public.fin_expenses;
create trigger fin_expenses_vat_guard before update on public.fin_expenses for each row execute function public.fin__expense_vat_guard();

-- ---------------------------------------------------------------- shared checks for purchase VAT (internal)

-- Validates the VAT details of a bill or expense and returns them cleaned:
-- {"deductible": bool, "vatClass": text, "documentRef": text|null, "supplierTaxNumber": text|null}.
-- Deductible defaults to (company VAT registered, VAT > 0 and a document reference); asking for it otherwise is refused.
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
    v_ded := v_reg and p_tax > 0 and v_ref is not null;
  elsif v_ded then
    if not v_reg then raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'the company is not VAT registered'; end if;
    if p_tax <= 0 then raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'there is no VAT on this document'; end if;
    if v_ref is null then raise exception 'VAT_NOT_DEDUCTIBLE' using detail = 'enter the supplier''s e-invoice number (or the customs declaration for an import)'; end if;
  end if;
  return jsonb_build_object('deductible', v_ded, 'vatClass', v_class, 'documentRef', v_ref, 'supplierTaxNumber', v_tin);
end $$;
revoke all on function public.fin__purchase_vat(uuid, jsonb, bigint, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- supplier bills with VAT (sql/064's function, plus VAT)

-- p_lines: [{ "orderLineId", "qty", "taxRateId"?: uuid | "exempt" }]. A line's rate: the one given, else the item's VAT default, else
-- the company default, else none. p_vat: { "taxMinor"?: the VAT printed on the supplier's invoice (default: the computed VAT),
-- "deductible"?, "documentRef"?, "vatClass"?, "supplierTaxNumber"? }.
drop function if exists public.pur_record_supplier_invoice(uuid, uuid, text, date, jsonb);
create or replace function public.pur_record_supplier_invoice(p_supplier_id uuid, p_order_id uuid, p_number text, p_invoice_date date, p_lines jsonb,
  p_vat jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.pur__guard(array['owner', 'admin']); v_order public.pur_orders%rowtype; v_invoice uuid; v_line jsonb; v_order_line uuid;
  v_qty numeric; v_cost bigint; v_item uuid; v_received numeric; v_billed numeric; v_count int := 0;
  v_default uuid; v_given text; v_rate_id uuid; v_rate numeric; v_tax bigint; v_vat jsonb; si public.pur_supplier_invoices;
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
    select item_id, unit_cost_minor, received_qty into v_item, v_cost, v_received from public.pur_order_lines where org_id = v_org and order_id = p_order_id and id = v_order_line;
    if not found then raise exception 'INVALID_INPUT'; end if;
    select coalesce(sum(il.qty), 0) into v_billed from public.pur_supplier_invoice_lines il join public.pur_supplier_invoices inv on inv.org_id = il.org_id and inv.id = il.invoice_id where il.org_id = v_org and il.order_line_id = v_order_line;
    if v_billed + v_qty > v_received then raise exception 'BILL_QTY_EXCEEDS_RECEIVED'; end if;

    -- the line's VAT rate (what the supplier charged; a company that is not registered still pays it, as cost)
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
          v_rate_id := null; v_rate := 0;   -- a removed default: no VAT computed; the printed VAT check below still applies
        end if;
      end if;
    end if;
    insert into public.pur_supplier_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_cost_minor, tax_rate_id, tax_rate)
    values (v_org, v_invoice, v_order_line, v_qty, v_cost, v_rate_id, v_rate);
    v_count := v_count + 1;
  end loop;

  select * into si from public.pur_supplier_invoices where org_id = v_org and id = v_invoice;
  -- the VAT as printed: within 1 minor unit per line (at least 5) of the computed VAT
  begin v_tax := coalesce((p_vat ->> 'taxMinor')::bigint, si.line_tax_minor); exception when others then raise exception 'INVALID_INPUT' using detail = 'taxMinor must be a whole number'; end;
  if v_tax < 0 then raise exception 'INVALID_INPUT' using detail = 'VAT cannot be negative'; end if;
  if abs(v_tax - si.line_tax_minor) > greatest(5, v_count) then
    raise exception 'VAT_MISMATCH' using detail = format('the VAT entered (%s) is too far from the VAT worked out from the lines (%s): check the rates on the lines', v_tax, si.line_tax_minor);
  end if;
  v_vat := public.fin__purchase_vat(v_org, p_vat, v_tax, p_supplier_id);
  perform set_config('erp.doc_totals', 'on', true);
  update public.pur_supplier_invoices
     set tax_minor = v_tax, gross_minor = net_minor + v_tax, vat_deductible = (v_vat ->> 'deductible')::boolean, vat_class = v_vat ->> 'vatClass',
         vat_document_ref = v_vat ->> 'documentRef', supplier_tax_number = v_vat ->> 'supplierTaxNumber'
   where org_id = v_org and id = v_invoice
  returning * into si;
  perform set_config('erp.doc_totals', '', true);

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'purchasing.supplier_invoice.recorded', 'supplier_invoice', v_invoice::text,
          format('Invoice %s recorded for %s minor units (%s before VAT, %s VAT%s) across %s line(s)', trim(p_number), si.gross_minor, si.net_minor, si.tax_minor,
                 case when si.tax_minor = 0 then '' when si.vat_deductible then ', deductible' else ', not deductible' end, v_count),
          jsonb_build_object('net_minor', si.net_minor, 'tax_minor', si.tax_minor, 'computed_tax_minor', si.line_tax_minor, 'gross_minor', si.gross_minor,
                             'vat_deductible', si.vat_deductible, 'vat_class', si.vat_class, 'vat_document_ref', si.vat_document_ref));
  return v_invoice;
end $$;
revoke all on function public.pur_record_supplier_invoice(uuid, uuid, text, date, jsonb, jsonb) from public, anon;
grant execute on function public.pur_record_supplier_invoice(uuid, uuid, text, date, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- expenses with VAT (sql/024's function, plus VAT)

-- p_amount_minor is the total paid (VAT included), as on the receipt. p_vat: { "taxMinor"?: VAT as printed (default 0), "taxRateId"?: a
-- VAT rate to check it against (within 5 minor units), "deductible"?, "documentRef"?, "vatClass"?, "supplierTaxNumber"? }.
drop function if exists public.fin_record_expense(date, uuid, bigint, uuid, text);
create or replace function public.fin_record_expense(p_date date, p_category_id uuid, p_amount_minor bigint, p_supplier_id uuid default null,
  p_note text default null, p_vat jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.fin__guard(); v_cur char(3); v_id uuid; v_no text; v_tax bigint; v_rate_id uuid; v_rate numeric := 0; v_vat jsonb;
begin
  if p_date is null or p_amount_minor is null or p_amount_minor <= 0 then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.fin_categories where org_id = v_org and id = p_category_id) then raise exception 'NOT_FOUND'; end if;
  if p_supplier_id is not null and not exists (select 1 from public.pur_suppliers where org_id = v_org and id = p_supplier_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  begin
    v_tax := coalesce((p_vat ->> 'taxMinor')::bigint, 0);
    v_rate_id := nullif(p_vat ->> 'taxRateId', '')::uuid;
  exception when others then raise exception 'INVALID_INPUT' using detail = 'taxMinor must be a whole number and taxRateId a rate id'; end;
  if v_tax < 0 or v_tax >= p_amount_minor then raise exception 'INVALID_INPUT' using detail = 'the VAT must be below the total'; end if;
  if v_rate_id is not null then
    select t.rate into v_rate from public.tax_rates t where t.org_id = v_org and t.id = v_rate_id and t.tax_type = 'T1' and t.deleted_at is null;
    if not found then raise exception 'INVALID_INPUT' using detail = 'that VAT rate does not exist'; end if;
    if abs(v_tax - round(p_amount_minor * v_rate / (100 + v_rate))) > 5 then
      raise exception 'VAT_MISMATCH' using detail = format('the VAT entered (%s) does not match %s%% of the total (%s)', v_tax, trim_scale(v_rate), round(p_amount_minor * v_rate / (100 + v_rate)));
    end if;
  end if;
  v_vat := public.fin__purchase_vat(v_org, p_vat, v_tax, p_supplier_id);
  select default_currency into v_cur from public.organizations where id = v_org;
  v_no := public.fin__next(v_org, 'expense', 'EXP-');
  insert into public.fin_expenses (org_id, number, expense_date, category_id, supplier_id, amount_minor, net_minor, tax_minor, tax_rate_id, tax_rate,
                                   vat_deductible, vat_class, vat_document_ref, supplier_tax_number, currency, note, created_by)
  values (v_org, v_no, p_date, p_category_id, p_supplier_id, p_amount_minor, p_amount_minor - v_tax, v_tax, v_rate_id, v_rate,
          (v_vat ->> 'deductible')::boolean, v_vat ->> 'vatClass', v_vat ->> 'documentRef', v_vat ->> 'supplierTaxNumber', v_cur, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'finance.expense.recorded', 'finance_expense', v_id::text,
          format('%s: %s minor units %s on %s%s', v_no, p_amount_minor, v_cur, p_date,
                 case when v_tax = 0 then '' else format(' (%s VAT, %s)', v_tax, case when (v_vat ->> 'deductible')::boolean then 'deductible' else 'not deductible' end) end),
          jsonb_build_object('amount_minor', p_amount_minor, 'tax_minor', v_tax) || v_vat);
  return jsonb_build_object('id', v_id, 'number', v_no);
end $$;
revoke all on function public.fin_record_expense(date, uuid, bigint, uuid, text, jsonb) from public, anon;
grant execute on function public.fin_record_expense(date, uuid, bigint, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- "VAT from" (sql/086's core_set_vat, plus settings.vat_from)

create or replace function public.core_set_vat(p_registered boolean, p_default_rate_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_reg boolean; v_rate text; r public.tax_rates; v_added boolean := false;
  v_rate_id uuid := p_default_rate_id; v_from text;
begin
  if p_registered is null then raise exception 'INVALID_INPUT'; end if;
  if v_rate_id is null and p_registered then
    select x.id into v_rate_id from public.tax_rates x where x.org_id = v_org and x.tax_type = 'T1' and x.is_default and x.deleted_at is null;
    if v_rate_id is null then
      insert into public.tax_rates (org_id, tax_type, sub_type, rate, label, is_default)
      values (v_org, 'T1', 'V009', 14,
              case when exists (select 1 from public.tax_rates x where x.org_id = v_org and lower(x.label) = 'vat 14%' and x.deleted_at is null)
                   then 'Standard VAT 14%' else 'VAT 14%' end, true)
      returning id into v_rate_id;
      v_added := true;
    end if;
  end if;
  if v_rate_id is not null then
    select * into r from public.tax_rates x where x.org_id = v_org and x.id = v_rate_id and x.deleted_at is null;
    if not found then raise exception 'NOT_FOUND' using detail = 'that tax rate does not exist'; end if;
    if r.tax_type <> 'T1' then raise exception 'INVALID_INPUT' using detail = 'the default VAT rate must be a VAT (T1) rate'; end if;
  end if;
  select coalesce((o.settings ->> 'vat_registered')::boolean, false), o.settings ->> 'default_vat_rate_id', o.settings ->> 'vat_from'
    into v_reg, v_rate, v_from
    from public.organizations o where o.id = v_org for update;
  if v_reg = p_registered and v_rate is not distinct from v_rate_id::text then
    return jsonb_build_object('vatRegistered', p_registered, 'defaultVatRateId', v_rate_id, 'vatFrom', v_from);
  end if;
  -- the first day VAT applies: the day it is first switched on (company time zone); kept when it is switched off and on again
  if p_registered and v_from is null then v_from := public.acc__local_date(v_org, now())::text; end if;
  update public.organizations o
     set settings = case when v_rate_id is null then coalesce(o.settings, '{}'::jsonb) - 'default_vat_rate_id'
                         else coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('default_vat_rate_id', v_rate_id::text) end
                    || jsonb_build_object('vat_registered', p_registered)
                    || case when v_from is null then '{}'::jsonb else jsonb_build_object('vat_from', v_from) end
   where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.vat_changed', 'organization', v_org::text,
          case when p_registered then format('VAT registered from %s, default rate %s (%s%%)%s', v_from, r.label, trim_scale(r.rate),
                                             case when v_added then ', added as the company''s VAT rate' else '' end)
               else 'Not VAT registered' end,
          jsonb_build_object('vat_registered', v_reg, 'default_vat_rate_id', v_rate),
          jsonb_build_object('vat_registered', p_registered, 'default_vat_rate_id', v_rate_id, 'rate_added', v_added, 'vat_from', v_from));
  return jsonb_build_object('vatRegistered', p_registered, 'defaultVatRateId', v_rate_id, 'rateAdded', v_added, 'vatFrom', v_from);
end $$;

-- Companies already registered before this migration: VAT from the day they switched it on (their audit row), else today.
update public.organizations o
   set settings = o.settings || jsonb_build_object('vat_from', coalesce(
         (select public.acc__local_date(o.id, min(a.occurred_at))::text from public.audit_log a
           where a.org_id = o.id and a.action = 'organization.vat_changed' and (a.after ->> 'vat_registered')::boolean),
         public.acc__local_date(o.id, now())::text))
 where coalesce((o.settings ->> 'vat_registered')::boolean, false) and o.settings ->> 'vat_from' is null;

-- ---------------------------------------------------------------- posting with input VAT (sql/046's two functions)

create or replace function public.acc__post_pur_invoice(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare si public.pur_supplier_invoices; v_received bigint; v_cost bigint; v_input bigint; v_diff bigint;
begin
  select * into si from public.pur_supplier_invoices where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(round(l.qty * ol.unit_cost_minor)), 0)::bigint into v_received
    from public.pur_supplier_invoice_lines l join public.pur_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
   where l.org_id = p_org and l.invoice_id = si.id;
  if si.gross_minor = 0 and v_received = 0 then return null; end if;
  v_input := case when si.vat_deductible then si.tax_minor else 0 end;
  v_cost := si.net_minor + si.tax_minor - v_input;      -- non-deductible VAT is part of the cost
  v_diff := v_cost - v_received;
  return public.acc__post(p_org, si.invoice_date, si.currency, 'supplier_invoice', si.id::text, 'billed', 'Supplier invoice ' || si.number,
    jsonb_build_array(
      jsonb_build_object('role', 'grni', 'debit', v_received, 'partyType', 'supplier', 'partyId', si.supplier_id),
      jsonb_build_object('role', 'price_variance', 'debit', greatest(v_diff, 0), 'credit', 0),
      jsonb_build_object('role', 'price_variance', 'credit', greatest(-v_diff, 0), 'debit', 0),
      jsonb_build_object('role', 'input_vat', 'debit', v_input),
      jsonb_build_object('role', 'payables', 'credit', si.gross_minor, 'partyType', 'supplier', 'partyId', si.supplier_id)),
    p_backfill);
end $$;

create or replace function public.acc__post_expense(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.fin_expenses; v_acct uuid; v_cr jsonb; v_input bigint;
begin
  select * into e from public.fin_expenses where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select c.account_id into v_acct from public.fin_categories c where c.org_id = p_org and c.id = e.category_id;
  v_cr := case when e.supplier_id is not null then jsonb_build_object('role', 'payables', 'partyType', 'supplier', 'partyId', e.supplier_id)
               else jsonb_build_object('role', 'expense_payables') end;
  v_input := case when e.vat_deductible then e.tax_minor else 0 end;
  return public.acc__post(p_org, e.expense_date, e.currency, 'expense', e.id::text, 'expensed', 'Expense ' || e.number,
    jsonb_build_array(
      case when v_acct is not null then jsonb_build_object('account', v_acct) else jsonb_build_object('role', 'expense_default') end
        || jsonb_build_object('debit', e.amount_minor - v_input, 'memo', e.note),
      jsonb_build_object('role', 'input_vat', 'debit', v_input),
      v_cr || jsonb_build_object('credit', e.amount_minor)),
    p_backfill);
end $$;
revoke all on function public.acc__post_pur_invoice(uuid, uuid, boolean), public.acc__post_expense(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- what is owed on a bill: its gross
-- The two functions below are their sql/086 versions with only the bill total replaced by the stored gross.

create or replace function public.fin_record_payment(p_direction text, p_amount_minor bigint, p_paid_on date, p_method text,
  p_customer_invoice_id uuid default null, p_supplier_invoice_id uuid default null, p_expense_id uuid default null, p_note text default null,
  p_treasury_account_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.fin__guard();
  v_cur char(3); v_total bigint; v_paid bigint; v_id uuid; v_no text; v_via text;
begin
  if p_amount_minor is null or p_amount_minor <= 0 or p_paid_on is null or p_method not in ('cash', 'bank', 'card', 'cheque', 'other') then raise exception 'INVALID_INPUT'; end if;

  if p_direction = 'in' then
    if p_customer_invoice_id is null or p_supplier_invoice_id is not null or p_expense_id is not null then raise exception 'INVALID_INPUT'; end if;
    select i.currency into v_cur from public.sal_invoices i where i.org_id = v_org and i.id = p_customer_invoice_id and i.status = 'issued' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_total := public.sal__invoice_due(v_org, p_customer_invoice_id);   -- gross, net of approved notes (sql/086)
    select coalesce(sum(amount_minor), 0) into v_paid from public.fin_payments where org_id = v_org and customer_invoice_id = p_customer_invoice_id and status = 'recorded';
  elsif p_direction = 'out' then
    if ((p_supplier_invoice_id is not null)::int + (p_expense_id is not null)::int) <> 1 or p_customer_invoice_id is not null then raise exception 'INVALID_INPUT'; end if;
    if p_supplier_invoice_id is not null then
      select i.currency into v_cur from public.pur_supplier_invoices i where i.org_id = v_org and i.id = p_supplier_invoice_id for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      select i.gross_minor into v_total from public.pur_supplier_invoices i where i.org_id = v_org and i.id = p_supplier_invoice_id;   -- gross (sql/087)
      select coalesce(sum(amount_minor), 0) into v_paid from public.fin_payments where org_id = v_org and supplier_invoice_id = p_supplier_invoice_id and status = 'recorded';
    else
      select e.currency, e.amount_minor into v_cur, v_total from public.fin_expenses e where e.org_id = v_org and e.id = p_expense_id and e.status = 'recorded' for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      select coalesce(sum(amount_minor), 0) into v_paid from public.fin_payments where org_id = v_org and expense_id = p_expense_id and status = 'recorded';
    end if;
  else
    raise exception 'INVALID_INPUT';
  end if;

  if v_paid + p_amount_minor > v_total then raise exception 'OVERPAYMENT'; end if;

  v_no := public.fin__next(v_org, 'payment', 'PAY-');
  insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, supplier_invoice_id, expense_id, note, created_by, treasury_account_id)
  values (v_org, v_no, p_direction, p_amount_minor, v_cur, p_paid_on, p_method, p_customer_invoice_id, p_supplier_invoice_id, p_expense_id, nullif(trim(p_note), ''), auth.uid(), p_treasury_account_id)
  returning id into v_id;
  select ' via ' || code into v_via from public.trs_accounts where org_id = v_org and id = p_treasury_account_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'finance.payment.recorded', 'finance_payment', v_id::text,
          format('%s %s: %s minor units %s by %s%s', v_no, case p_direction when 'in' then 'received' else 'paid' end, p_amount_minor, v_cur, p_method, coalesce(v_via, '')));
  return jsonb_build_object('id', v_id, 'number', v_no);
end $$;

create or replace function public.insights_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid := public.require_org_role(array['owner', 'admin']);
  v_cur  text;
  m0     date := date_trunc('month', current_date)::date;
  v_months jsonb; v_owed bigint; v_overdue bigint; v_owe bigint; v_stock bigint; v_low int; v_exp jsonb; v_dec jsonb; v_top jsonb; v_sup jsonb; v_single int;
begin
  select default_currency into v_cur from public.organizations where id = v_org;

  -- last 12 months, oldest first
  select jsonb_agg(jsonb_build_object('month', to_char(x.ms, 'YYYY-MM'), 'revenue', x.rev, 'cogs', x.cogs, 'expenses', x.exp, 'net', x.rev - x.cogs - x.exp) order by x.ms)
    into v_months
    from (
      select s.ms,
        coalesce((select sum(round(il.qty * il.unit_price_minor)) from public.sal_invoices i join public.sal_invoice_lines il on il.org_id = i.org_id and il.invoice_id = i.id
                   where i.org_id = v_org and i.status = 'issued' and i.invoice_date >= s.ms and i.invoice_date < (s.ms + interval '1 month')::date), 0)::bigint as rev,
        coalesce((select sum(round(-m.qty * coalesce(m.unit_cost_minor, it.avg_cost_minor))) from public.inv_stock_moves m join public.inv_items it on it.org_id = m.org_id and it.id = m.item_id
                   where m.org_id = v_org and m.kind = 'issue' and m.posted_at >= s.ms and m.posted_at < (s.ms + interval '1 month')
                     and m.request_id in (select so.request_id from public.sal_orders so where so.org_id = v_org and so.request_id is not null)), 0)::bigint as cogs,
        coalesce((select sum(e.amount_minor) from public.fin_expenses e where e.org_id = v_org and e.status = 'recorded' and e.expense_date >= s.ms and e.expense_date < (s.ms + interval '1 month')::date), 0)::bigint as exp
      from (select (m0 - make_interval(months => k))::date as ms from generate_series(0, 11) k) s
    ) x;

  -- money owed to me, and the overdue part
  select coalesce(sum(t.total - t.paid), 0), coalesce(sum(t.total - t.paid) filter (where t.invoice_date < current_date - 30), 0)
    into v_owed, v_overdue
    from (select i.invoice_date,
                 public.sal__invoice_due(i.org_id, i.id) as total,
                 (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = i.org_id and p.customer_invoice_id = i.id and p.status = 'recorded')::bigint as paid
            from public.sal_invoices i where i.org_id = v_org and i.status = 'issued') t;

  -- money I owe: supplier invoices and recorded expenses, less what was paid
  select coalesce(sum(t.total - t.paid), 0) into v_owe from (
    select i.gross_minor as total,
           (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = i.org_id and p.supplier_invoice_id = i.id and p.status = 'recorded')::bigint as paid
      from public.pur_supplier_invoices i where i.org_id = v_org
    union all
    select e.amount_minor, (select coalesce(sum(p.amount_minor), 0) from public.fin_payments p where p.org_id = e.org_id and p.expense_id = e.id and p.status = 'recorded')::bigint
      from public.fin_expenses e where e.org_id = v_org and e.status = 'recorded') t;

  select coalesce(round(sum(b.on_hand * it.avg_cost_minor)), 0)::bigint into v_stock
    from public.inv_stock_balances b join public.inv_items it on it.org_id = b.org_id and it.id = b.item_id where b.org_id = v_org and it.deleted_at is null;

  select count(*) into v_low from (
    select it.id from public.inv_items it left join public.inv_stock_balances b on b.org_id = it.org_id and b.item_id = it.id
     where it.org_id = v_org and it.deleted_at is null and it.reorder_level is not null
     group by it.id, it.reorder_level having coalesce(sum(b.on_hand - b.reserved), 0) <= it.reorder_level) z;

  -- stock that expires: batches, quantity and value at cost, by window (quarantined stock is counted too: it still sits there)
  select jsonb_build_object(
      'expired',  jsonb_build_object('batches', count(*) filter (where d < 0),               'valueMinor', coalesce(sum(val) filter (where d < 0), 0)::bigint),
      'in30',     jsonb_build_object('batches', count(*) filter (where d between 0 and 30),  'valueMinor', coalesce(sum(val) filter (where d between 0 and 30), 0)::bigint),
      'in60',     jsonb_build_object('batches', count(*) filter (where d between 31 and 60), 'valueMinor', coalesce(sum(val) filter (where d between 31 and 60), 0)::bigint),
      'in90',     jsonb_build_object('batches', count(*) filter (where d between 61 and 90), 'valueMinor', coalesce(sum(val) filter (where d between 61 and 90), 0)::bigint))
    into v_exp
    from (select (b.expiry_date - current_date) as d, round(sum(bb.qty * it.avg_cost_minor))::bigint as val
            from public.inv_batch_balances bb join public.inv_batches b on b.org_id = bb.org_id and b.id = bb.batch_id join public.inv_items it on it.org_id = b.org_id and it.id = b.item_id
           where bb.org_id = v_org and bb.qty > 0 and b.expiry_date is not null and b.expiry_date <= current_date + 90 group by b.id, b.expiry_date) z;

  select jsonb_build_object('submitted', count(*) filter (where status = 'submitted'), 'approvedNotIssued', count(*) filter (where status = 'approved'),
                            'oldestSubmittedHours', coalesce(round(extract(epoch from (now() - min(created_at) filter (where status = 'submitted'))) / 3600), 0))
    into v_dec from public.inv_requests where org_id = v_org and status in ('submitted', 'approved');

  -- best sellers, last 90 days
  select coalesce(jsonb_agg(jsonb_build_object('sku', t.sku, 'name', t.name, 'revenue', t.rev) order by t.rev desc), '[]'::jsonb) into v_top from (
    select it.sku, it.name, sum(round(il.qty * il.unit_price_minor))::bigint as rev
      from public.sal_invoices i join public.sal_invoice_lines il on il.org_id = i.org_id and il.invoice_id = i.id
      join public.sal_order_lines ol on ol.org_id = il.org_id and ol.id = il.order_line_id join public.inv_items it on it.org_id = ol.org_id and it.id = ol.item_id
     where i.org_id = v_org and i.status = 'issued' and i.invoice_date >= current_date - 90 group by it.sku, it.name order by rev desc limit 5) t;

  -- who we depend on: purchases of the last 12 months by supplier, and items bought from only one supplier
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'valueMinor', t.val, 'sharePercent', round(100.0 * t.val / nullif(t.tot, 0), 1)) order by t.val desc), '[]'::jsonb) into v_sup from (
    select s.name, sum(round(pl.qty * pl.unit_cost_minor))::bigint as val, sum(sum(round(pl.qty * pl.unit_cost_minor))) over ()::bigint as tot
      from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id join public.pur_suppliers s on s.org_id = po.org_id and s.id = po.supplier_id
     where po.org_id = v_org and po.status = 'received' and po.received_at >= now() - interval '12 months' group by s.name order by val desc limit 3) t;
  select count(*) into v_single from (
    select pl.item_id from public.pur_orders po join public.pur_order_lines pl on pl.org_id = po.org_id and pl.order_id = po.id
     where po.org_id = v_org and po.status = 'received' and po.received_at >= now() - interval '12 months' group by pl.item_id having count(distinct po.supplier_id) = 1) z;

  return jsonb_build_object(
    'currency', v_cur, 'asOf', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'months', coalesce(v_months, '[]'::jsonb),
    'owedToMeMinor', v_owed, 'overdueMinor', v_overdue, 'iOweMinor', v_owe, 'stockValueMinor', v_stock, 'itemsLow', v_low,
    'expiry', v_exp, 'decisions', v_dec, 'topProducts', v_top, 'topSuppliers', v_sup, 'singleSourceItems', v_single);
end $$;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- Expect 0, 0, 0: bills whose net differs from their lines; bills or expenses whose gross is not net + VAT; lines without net.
select (select count(*) from public.pur_supplier_invoices i
          left join (select l.org_id, l.invoice_id, sum(l.net_minor) as net from public.pur_supplier_invoice_lines l group by 1, 2) s
            on s.org_id = i.org_id and s.invoice_id = i.id
         where i.net_minor <> coalesce(s.net, 0)) as bills_off,
       (select count(*) from public.pur_supplier_invoices where gross_minor <> net_minor + tax_minor)
     + (select count(*) from public.fin_expenses where amount_minor <> net_minor + tax_minor) as totals_off,
       (select count(*) from public.pur_supplier_invoice_lines where net_minor is null) as lines_without_net;
-- Expect: users can record bills and expenses (true, true); anonymous cannot (false); the helper is closed to users (false).
select has_function_privilege('authenticated', 'public.pur_record_supplier_invoice(uuid, uuid, text, date, jsonb, jsonb)', 'execute') as users_bill,
       has_function_privilege('authenticated', 'public.fin_record_expense(date, uuid, bigint, uuid, text, jsonb)', 'execute') as users_expense,
       has_function_privilege('anon', 'public.fin_record_expense(date, uuid, bigint, uuid, text, jsonb)', 'execute') as anon_expense,
       has_function_privilege('authenticated', 'public.fin__purchase_vat(uuid, jsonb, bigint, uuid)', 'execute') as users_helper;
