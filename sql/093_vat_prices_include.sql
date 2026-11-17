-- 093_vat_prices_include.sql
-- VAT part 5 (documentation/plans/VAT_PLAN.md section 10 item 5; Ben, 17 Nov: "do 5"): sales prices that include VAT.
--   * Company setting settings.prices_include_vat (off by default), changed by the owner (core_set_prices_include_vat, audited).
--   * When it is on, a new sales invoice line's price (from the sales order) is the price WITH VAT. Each invoice and note line records
--     how its price was typed (price_includes_vat, copied, so a later change of the setting never alters a document). For such a line:
--     gross = round(qty x price); net = round(gross x 100 / (100 + rate)); VAT = gross - net (per line, half away from zero; to confirm
--     with the accountant against how ETA expects inclusive prices). Lines typed before VAT keep sql/086's rule.
--   * Credit and debit notes take the invoice line's way, so a note on an inclusive line is inclusive too.
--   * Supplier bills are unchanged (their prices are before VAT, as on the supplier's e-invoice).
--   * Shopify (prices include VAT): allowed with VAT when the setting is on. VAT can be switched on while Shopify is on only then,
--     an invoice for a Shopify order is refused only when it is off, and the setting cannot be switched off while VAT and Shopify
--     are both on. Companies with the setting off keep sql/088's block.
-- Depends on sql/001-092. Rerun-safe. Then run sql/tests/088_vat_prices_include.sql.

begin;

alter table public.sal_invoice_lines add column if not exists price_includes_vat boolean not null default false;
alter table public.sal_note_lines add column if not exists price_includes_vat boolean not null default false;

-- sql/086's line maths, with the inclusive rule. Callers' net and VAT are ignored.
create or replace function public.sal__line_tax() returns trigger
language plpgsql set search_path = public as $$
declare v_gross bigint;
begin
  new.tax_rate := coalesce(new.tax_rate, 0);
  if new.price_includes_vat then
    v_gross := round(new.qty * new.unit_price_minor)::bigint;
    new.net_minor := round(v_gross * 100 / (100 + new.tax_rate))::bigint;
    new.tax_minor := v_gross - new.net_minor;
  else
    new.net_minor := round(new.qty * new.unit_price_minor)::bigint;
    new.tax_minor := round(new.net_minor * new.tax_rate / 100)::bigint;
  end if;
  return new;
end $$;

-- The owner switches it. Refused off while VAT and Shopify are both on (Shopify's prices include VAT). Audited.
create or replace function public.core_set_prices_include_vat(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner']); v_before boolean; v_reg boolean;
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  select coalesce((o.settings ->> 'prices_include_vat')::boolean, false), coalesce((o.settings ->> 'vat_registered')::boolean, false)
    into v_before, v_reg from public.organizations o where o.id = v_org for update;
  if v_before = p_on then return p_on; end if;
  if not p_on and v_reg and exists (select 1 from public.core_integrations i where i.org_id = v_org and i.kind = 'shopify' and i.enabled) then
    raise exception 'VAT_SHOPIFY_NOT_SUPPORTED' using detail = 'Shopify prices include VAT: switch Shopify off first';
  end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('prices_include_vat', p_on) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.prices_include_vat_changed', 'organization', v_org::text,
          case when p_on then 'Sales prices now include VAT (new invoices only)' else 'Sales prices are now before VAT (new invoices only)' end,
          jsonb_build_object('prices_include_vat', v_before), jsonb_build_object('prices_include_vat', p_on));
  return p_on;
end $$;
revoke all on function public.core_set_prices_include_vat(boolean) from public, anon;
grant execute on function public.core_set_prices_include_vat(boolean) to authenticated;

-- The three functions below are their latest versions (sal_create_invoice from sql/088, sal_submit_note from sql/086, core_set_vat
-- from sql/088) with only the inclusive-price changes (copied and checked by script).

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
  v_incl    boolean;
begin
  if p_invoice_date is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT'; end if;

  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' or o.request_id is null then raise exception 'NOT_DELIVERED'; end if;
  select r.status into v_rs from public.inv_requests r where r.org_id = v_org and r.id = o.request_id;
  if v_rs is distinct from 'issued' then raise exception 'NOT_DELIVERED'; end if;

  select coalesce((s.settings ->> 'vat_registered')::boolean, false), nullif(s.settings ->> 'default_vat_rate_id', '')::uuid
    into v_vat, v_default from public.organizations s where s.id = v_org;
  -- sql/093: sales prices include VAT (copied onto each line)
  select coalesce((s.settings ->> 'prices_include_vat')::boolean, false) into v_incl from public.organizations s where s.id = v_org;
  -- Shopify prices include VAT (not supported yet, VAT plan part 5): no invoice for a Shopify order while VAT is on (sql/088)
  if v_vat and not v_incl and exists (select 1 from public.sal_shopify_orders so where so.org_id = v_org and so.sales_order_id = o.id) then
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

    insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, tax_rate_id, tax_rate, price_includes_vat)
    values (v_org, v_id, v_line, v_qty, v_price, v_rate_id, v_rate, v_vat and v_incl);
    v_count := v_count + 1;
  end loop;

  select * into inv from public.sal_invoices where org_id = v_org and id = v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'sales.invoice.created', 'sales_invoice', v_id::text,
          format('%s for %s: %s minor units (%s before VAT, %s VAT) across %s line(s)', v_no, o.number, inv.gross_minor, inv.net_minor, inv.tax_minor, v_count),
          jsonb_build_object('net_minor', inv.net_minor, 'tax_minor', inv.tax_minor, 'gross_minor', inv.gross_minor));
  return jsonb_build_object('id', v_id, 'number', v_no, 'netMinor', inv.net_minor, 'taxMinor', inv.tax_minor, 'grossMinor', inv.gross_minor);
end $$;

create or replace function public.sal_submit_note(p_invoice_id uuid, p_kind text, p_reason text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.sal__guard(array['owner', 'admin', 'member']);
  inv       public.sal_invoices;
  il        public.sal_invoice_lines;
  v_id      uuid := gen_random_uuid();
  v_number  text;
  v_n       bigint;
  r         record;
  e         jsonb;
  v_price   bigint;
  v_taken   numeric;
  v_valid   jsonb := '[]'::jsonb;
  v_lnet    bigint;
  v_net     bigint := 0;
  v_tax     bigint := 0;
  v_chk_net bigint;
  v_chk_tax bigint;
begin
  if p_kind is null or p_kind not in ('credit', 'debit') then raise exception 'INVALID_INPUT' using detail = 'kind must be credit or debit'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 or length(p_reason) > 500 then raise exception 'INVALID_INPUT' using detail = 'a reason of up to 500 characters is required'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT' using detail = 'add at least one line'; end if;

  -- Lock the invoice so two notes against it are checked one after the other.
  select * into inv from public.sal_invoices i where i.org_id = v_org and i.id = p_invoice_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if inv.status <> 'issued' then raise exception 'INVALID_STATE' using detail = 'the invoice is void'; end if;

  -- First pass: check every line against the invoice and add up the totals. The same invoice line twice is summed.
  for r in
    select (x ->> 'invoiceLineId')::uuid as line_id, sum((x ->> 'qty')::numeric) as qty, max((x ->> 'unitPriceMinor')::bigint) as price
    from jsonb_array_elements(p_lines) x group by 1 order by 1
  loop
    if r.line_id is null or r.qty is null or r.qty <= 0 or (r.price is not null and r.price < 0) then
      raise exception 'INVALID_INPUT' using detail = 'quantities must be above zero and prices not negative';
    end if;
    select * into il from public.sal_invoice_lines l where l.org_id = v_org and l.invoice_id = inv.id and l.id = r.line_id;
    if not found then raise exception 'INVALID_INPUT' using detail = 'that line is not on the invoice'; end if;
    v_price := coalesce(r.price, il.unit_price_minor);
    if p_kind = 'credit' then
      if v_price > il.unit_price_minor then raise exception 'NOTE_EXCEEDS_INVOICE' using detail = 'a credit note cannot credit more per unit than was invoiced'; end if;
      select coalesce(sum(nl.qty), 0) into v_taken
        from public.sal_note_lines nl join public.sal_notes n on n.org_id = nl.org_id and n.id = nl.note_id
       where nl.org_id = v_org and nl.invoice_line_id = il.id and n.kind = 'credit' and n.status in ('submitted', 'approved');
      if v_taken + r.qty > il.qty then
        raise exception 'NOTE_EXCEEDS_INVOICE' using detail = format('%s invoiced, %s already credited or waiting, %s requested', il.qty, v_taken, r.qty);
      end if;
    end if;
    v_valid := v_valid || jsonb_build_array(jsonb_build_object('line', il.id, 'qty', r.qty, 'price', v_price, 'rateId', il.tax_rate_id, 'rate', il.tax_rate, 'incl', il.price_includes_vat));
    -- same maths as sal__line_tax (the trigger writes the stored figures; the check below proves they agree)
    if il.price_includes_vat then   -- sql/093: the note line is typed as the invoice line was (price with VAT)
      v_lnet := round(round(r.qty * v_price) * 100 / (100 + il.tax_rate))::bigint;
      v_net := v_net + v_lnet;
      v_tax := v_tax + round(r.qty * v_price)::bigint - v_lnet;
    else
      v_lnet := round(r.qty * v_price)::bigint;
      v_net := v_net + v_lnet;
      v_tax := v_tax + round(v_lnet * il.tax_rate / 100)::bigint;
    end if;
  end loop;

  insert into public.inv_counters (org_id, key, value) values (v_org, case p_kind when 'credit' then 'sales_credit_note' else 'sales_debit_note' end, 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  v_number := case p_kind when 'credit' then 'CN-' else 'DN-' end || lpad(v_n::text, 4, '0');

  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, net_minor, tax_minor, gross_minor, requester_id)
  values (v_id, v_org, v_number, p_kind, inv.id, inv.customer_id, inv.currency, trim(p_reason), v_net + v_tax, v_net, v_tax, v_net + v_tax, auth.uid());
  for e in select x from jsonb_array_elements(v_valid) x loop
    insert into public.sal_note_lines (org_id, note_id, invoice_line_id, qty, unit_price_minor, tax_rate_id, tax_rate, price_includes_vat)
    values (v_org, v_id, (e ->> 'line')::uuid, (e ->> 'qty')::numeric, (e ->> 'price')::bigint, (e ->> 'rateId')::uuid, (e ->> 'rate')::numeric, (e ->> 'incl')::boolean);
  end loop;
  select coalesce(sum(nl.net_minor), 0)::bigint, coalesce(sum(nl.tax_minor), 0)::bigint into v_chk_net, v_chk_tax
    from public.sal_note_lines nl where nl.org_id = v_org and nl.note_id = v_id;
  if v_chk_net <> v_net or v_chk_tax <> v_tax then
    raise exception 'INVALID_STATE' using detail = 'note totals do not match its lines';
  end if;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'sales.note.submitted', 'sales_note', v_id::text,
          format('%s %s note for invoice %s: %s minor units (%s before VAT, %s VAT) across %s line(s)', v_number, p_kind, inv.number, v_net + v_tax, v_net, v_tax, jsonb_array_length(v_valid)),
          jsonb_build_object('net_minor', v_net, 'tax_minor', v_tax, 'gross_minor', v_net + v_tax));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

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
  -- sql/093: allowed with Shopify when sales prices include VAT
  if p_registered and not v_reg and not coalesce((select (o.settings ->> 'prices_include_vat')::boolean from public.organizations o where o.id = v_org), false)
     and exists (select 1 from public.core_integrations i where i.org_id = v_org and i.kind = 'shopify' and i.enabled) then
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

commit;

-- Verification (read-only): the columns exist (true, true); users can set it (true), anonymous cannot (false).
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sal_invoice_lines' and column_name = 'price_includes_vat') as invoice_lines,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sal_note_lines' and column_name = 'price_includes_vat') as note_lines,
       has_function_privilege('authenticated', 'public.core_set_prices_include_vat(boolean)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.core_set_prices_include_vat(boolean)', 'execute') as anon_can_set;
