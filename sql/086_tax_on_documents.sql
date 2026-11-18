-- 086_tax_on_documents.sql
-- VAT part 1 (documentation/plans/VAT_PLAN.md, approved 16 Nov 2026: prices are typed before VAT; invoices issued before this keep
-- zero tax). ADR-0005 draft (plan section 12): VAT is computed and stored on each document line, once, by the database.
--   * Customer invoice lines and credit/debit note lines get tax_rate_id (the company's rate, may be null), tax_rate (copied, so a later
--     rate change never alters a document), net_minor and tax_minor. A BEFORE INSERT trigger computes net = round(qty x price) and
--     tax = round(net x rate / 100) (half away from zero, in minor units, as ETA documents do), whatever writes the line.
--   * Invoices and notes get net_minor, tax_minor, gross_minor. An invoice's are the sums of its lines (kept by the line trigger);
--     a note's are computed by sal_submit_note, and total_minor = gross_minor. Nothing else may change them.
--   * Existing rows are backfilled once: net = gross = round(qty x price) per line, tax = 0. Nothing posted changes.
--   * Company setting: settings.vat_registered (off by default) and settings.default_vat_rate_id (one of its VAT (T1) rates), changed
--     by core_set_vat (owners and admins, audited). Not registered: every new line has rate 0 and no rate id.
--   * sal_create_invoice: each line takes p_lines[].taxRateId (a rate id or "exempt"), else the item's default VAT rate, else the
--     company default. sal_submit_note: note lines take the invoice line's rate; the tax is recomputed on the note's quantity and price.
--   * Posting: invoice Dr receivables gross / Cr sales net / Cr output VAT tax; credit note Dr sales returns net / Dr output VAT tax /
--     Cr receivables gross; debit note the reverse. New account roles output_vat and input_vat, accounts 2871 Output VAT payable (under
--     28) and 1811 Input VAT recoverable (under 18), added to every company that has a chart (and to new charts).
--   * Amount owed = gross - approved credit notes + approved debit notes - payments, from one helper (sal__invoice_owed), now used by
--     the overpayment check, payment links, owner insights, the overdue-invoice alert and the open-invoices report link. Revenue
--     figures stay on net amounts.
-- Supplier bills (input VAT) are part 2 (sql/087). Depends on sql/001-085. Rerun-safe. Run the whole file, then
-- sql/tests/082_vat_on_documents.sql.

begin;

-- ---------------------------------------------------------------- columns

alter table public.sal_invoice_lines add column if not exists tax_rate_id uuid;
alter table public.sal_invoice_lines add column if not exists tax_rate numeric(8, 5) not null default 0;
alter table public.sal_invoice_lines add column if not exists net_minor bigint;
alter table public.sal_invoice_lines add column if not exists tax_minor bigint not null default 0;

alter table public.sal_note_lines add column if not exists tax_rate_id uuid;
alter table public.sal_note_lines add column if not exists tax_rate numeric(8, 5) not null default 0;
alter table public.sal_note_lines add column if not exists net_minor bigint;
alter table public.sal_note_lines add column if not exists tax_minor bigint not null default 0;

alter table public.sal_invoices add column if not exists net_minor bigint not null default 0;
alter table public.sal_invoices add column if not exists tax_minor bigint not null default 0;
alter table public.sal_invoices add column if not exists gross_minor bigint not null default 0;

alter table public.sal_notes add column if not exists net_minor bigint;
alter table public.sal_notes add column if not exists tax_minor bigint not null default 0;
alter table public.sal_notes add column if not exists gross_minor bigint;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_invoice_lines_tax_rate_fk') then
    alter table public.sal_invoice_lines add constraint sal_invoice_lines_tax_rate_fk foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sal_note_lines_tax_rate_fk') then
    alter table public.sal_note_lines add constraint sal_note_lines_tax_rate_fk foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sal_invoice_lines_tax_chk') then
    alter table public.sal_invoice_lines add constraint sal_invoice_lines_tax_chk check (tax_rate between 0 and 100 and tax_minor >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sal_note_lines_tax_chk') then
    alter table public.sal_note_lines add constraint sal_note_lines_tax_chk check (tax_rate between 0 and 100 and tax_minor >= 0);
  end if;
end $$;
create index if not exists sal_invoice_lines_org_tax_rate_idx on public.sal_invoice_lines (org_id, tax_rate_id) where tax_rate_id is not null;
create index if not exists sal_note_lines_org_tax_rate_idx on public.sal_note_lines (org_id, tax_rate_id) where tax_rate_id is not null;

-- ---------------------------------------------------------------- the line maths, in one place

-- net = round(qty x price); tax = round(net x rate / 100). numeric round() is half away from zero. Callers' net and tax are ignored.
create or replace function public.sal__line_tax() returns trigger
language plpgsql set search_path = public as $$
begin
  new.net_minor := round(new.qty * new.unit_price_minor)::bigint;
  new.tax_rate := coalesce(new.tax_rate, 0);
  new.tax_minor := round(new.net_minor * new.tax_rate / 100)::bigint;
  return new;
end $$;
revoke all on function public.sal__line_tax() from public, anon, authenticated;
drop trigger if exists sal_invoice_lines_tax on public.sal_invoice_lines;
create trigger sal_invoice_lines_tax before insert on public.sal_invoice_lines for each row execute function public.sal__line_tax();
drop trigger if exists sal_note_lines_tax on public.sal_note_lines;
create trigger sal_note_lines_tax before insert on public.sal_note_lines for each row execute function public.sal__line_tax();

-- An invoice's totals are the sums of its lines: each new line is added to its header (the only writer of the three totals).
create or replace function public.sal__invoice_line_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('erp.doc_totals', 'on', true);
  update public.sal_invoices
     set net_minor = net_minor + new.net_minor, tax_minor = tax_minor + new.tax_minor, gross_minor = gross_minor + new.net_minor + new.tax_minor
   where org_id = new.org_id and id = new.invoice_id;
  perform set_config('erp.doc_totals', '', true);
  return null;
end $$;
revoke all on function public.sal__invoice_line_rollup() from public, anon, authenticated;

-- Invoice totals change only through the line trigger above (or this migration's backfill).
create or replace function public.sal__invoice_totals_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.net_minor, new.tax_minor, new.gross_minor) is distinct from (old.net_minor, old.tax_minor, old.gross_minor)
     and current_setting('erp.doc_totals', true) is distinct from 'on' then
    raise exception 'INVALID_STATE' using detail = 'invoice totals come from its lines and cannot be edited';
  end if;
  return new;
end $$;
revoke all on function public.sal__invoice_totals_guard() from public, anon, authenticated;

-- A note written without its own net and gross (older code, fixtures) is a zero-tax note: net = gross = total.
create or replace function public.sal__note_totals_default() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.net_minor is null or new.gross_minor is null then
    new.net_minor := new.total_minor; new.tax_minor := 0; new.gross_minor := new.total_minor;
  end if;
  return new;
end $$;
revoke all on function public.sal__note_totals_default() from public, anon, authenticated;
drop trigger if exists sal_notes_totals_default on public.sal_notes;
create trigger sal_notes_totals_default before insert on public.sal_notes for each row execute function public.sal__note_totals_default();

-- sql/037's note guard, now also covering the three totals (backfill below sets erp.doc_totals).
create or replace function public.sal_notes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.requester_id <> old.requester_id or new.number <> old.number or new.kind <> old.kind
     or new.invoice_id <> old.invoice_id or new.customer_id <> old.customer_id or new.reason <> old.reason
     or new.total_minor <> old.total_minor or new.currency <> old.currency then
    raise exception 'INVALID_STATE' using detail = 'a note cannot be edited';
  end if;
  if (new.net_minor, new.tax_minor, new.gross_minor) is distinct from (old.net_minor, old.tax_minor, old.gross_minor)
     and current_setting('erp.doc_totals', true) is distinct from 'on' then
    raise exception 'INVALID_STATE' using detail = 'a note cannot be edited';
  end if;
  if new.status <> old.status and not (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled')) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- backfill (once; a rerun changes nothing)

select set_config('erp.doc_totals', 'on', true);

update public.sal_invoice_lines set net_minor = round(qty * unit_price_minor)::bigint where net_minor is null;
alter table public.sal_invoice_lines alter column net_minor set not null;

alter table public.sal_note_lines disable trigger sal_note_lines_append_only;
update public.sal_note_lines set net_minor = round(qty * unit_price_minor)::bigint where net_minor is null;
alter table public.sal_note_lines enable trigger sal_note_lines_append_only;
alter table public.sal_note_lines alter column net_minor set not null;

-- Header = sums of its stored lines (correct on a rerun too, as the lines hold their own figures).
update public.sal_invoices i
   set net_minor = s.net, tax_minor = s.tax, gross_minor = s.net + s.tax
  from (select l.org_id, l.invoice_id, sum(l.net_minor)::bigint as net, sum(l.tax_minor)::bigint as tax
          from public.sal_invoice_lines l group by l.org_id, l.invoice_id) s
 where s.org_id = i.org_id and s.invoice_id = i.id
   and (i.net_minor, i.tax_minor, i.gross_minor) is distinct from (s.net, s.tax, s.net + s.tax);

update public.sal_notes set net_minor = total_minor, tax_minor = 0, gross_minor = total_minor where net_minor is null or gross_minor is null;
alter table public.sal_notes alter column net_minor set not null;
alter table public.sal_notes alter column gross_minor set not null;

select set_config('erp.doc_totals', '', true);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_invoices_totals_chk') then
    alter table public.sal_invoices add constraint sal_invoices_totals_chk check (net_minor >= 0 and tax_minor >= 0 and gross_minor = net_minor + tax_minor);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sal_notes_totals_chk') then
    alter table public.sal_notes add constraint sal_notes_totals_chk
      check (net_minor >= 0 and tax_minor >= 0 and gross_minor = net_minor + tax_minor and total_minor = gross_minor);
  end if;
end $$;

-- The roll-up and the guard start after the backfill.
drop trigger if exists sal_invoice_lines_rollup on public.sal_invoice_lines;
create trigger sal_invoice_lines_rollup after insert on public.sal_invoice_lines for each row execute function public.sal__invoice_line_rollup();
drop trigger if exists sal_invoices_totals_guard on public.sal_invoices;
create trigger sal_invoices_totals_guard before update on public.sal_invoices for each row execute function public.sal__invoice_totals_guard();

-- ---------------------------------------------------------------- amount owed (one definition)

-- What the customer owes on an invoice before payments: gross - approved credit notes + approved debit notes.
create or replace function public.sal__invoice_due(p_org uuid, p_invoice uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select (coalesce((select i.gross_minor from public.sal_invoices i where i.org_id = p_org and i.id = p_invoice), 0)
        - coalesce((select sum(n.gross_minor) from public.sal_notes n where n.org_id = p_org and n.invoice_id = p_invoice and n.status = 'approved' and n.kind = 'credit'), 0)
        + coalesce((select sum(n.gross_minor) from public.sal_notes n where n.org_id = p_org and n.invoice_id = p_invoice and n.status = 'approved' and n.kind = 'debit'), 0))::bigint
$$;

-- What is still owed: the above less recorded payments.
create or replace function public.sal__invoice_owed(p_org uuid, p_invoice uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select (public.sal__invoice_due(p_org, p_invoice)
        - coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = p_org and p.customer_invoice_id = p_invoice and p.status = 'recorded'), 0))::bigint
$$;
revoke all on function public.sal__invoice_due(uuid, uuid), public.sal__invoice_owed(uuid, uuid) from public, anon, authenticated;

-- sql/057: payment links default to, and are capped at, what is still owed.
create or replace function public.fin__invoice_outstanding(p_org uuid, p_invoice uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select public.sal__invoice_owed(p_org, p_invoice)
$$;

-- ---------------------------------------------------------------- the VAT setting

-- Switch VAT registration on or off and choose the default rate (a VAT (T1) rate of the company). Switching on without naming one
-- takes the company's default VAT rate; when it has none, the standard rate (14%, ETA sub-type V009) is added as an ordinary company
-- rate (editable on the tax rate screens), so a company can switch on in one step. Owners and admins. Audited. Affects documents
-- created afterwards only.
create or replace function public.core_set_vat(p_registered boolean, p_default_rate_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_reg boolean; v_rate text; r public.tax_rates; v_added boolean := false;
  v_rate_id uuid := p_default_rate_id;
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
  select coalesce((o.settings ->> 'vat_registered')::boolean, false), o.settings ->> 'default_vat_rate_id' into v_reg, v_rate
    from public.organizations o where o.id = v_org for update;
  if v_reg = p_registered and v_rate is not distinct from v_rate_id::text then
    return jsonb_build_object('vatRegistered', p_registered, 'defaultVatRateId', v_rate_id);
  end if;
  update public.organizations o
     set settings = case when v_rate_id is null then coalesce(o.settings, '{}'::jsonb) - 'default_vat_rate_id'
                         else coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('default_vat_rate_id', v_rate_id::text) end
                    || jsonb_build_object('vat_registered', p_registered)
   where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.vat_changed', 'organization', v_org::text,
          case when p_registered then format('VAT registered, default rate %s (%s%%)%s', r.label, trim_scale(r.rate),
                                             case when v_added then ', added as the company''s VAT rate' else '' end)
               else 'Not VAT registered' end,
          jsonb_build_object('vat_registered', v_reg, 'default_vat_rate_id', v_rate),
          jsonb_build_object('vat_registered', p_registered, 'default_vat_rate_id', v_rate_id, 'rate_added', v_added));
  return jsonb_build_object('vatRegistered', p_registered, 'defaultVatRateId', v_rate_id, 'rateAdded', v_added);
end $$;
revoke all on function public.core_set_vat(boolean, uuid) from public, anon;
grant execute on function public.core_set_vat(boolean, uuid) to authenticated;

-- ---------------------------------------------------------------- invoices with VAT (sql/022's function, plus the tax rate per line)

-- p_lines: [{ "orderLineId": uuid, "qty": number, "taxRateId"?: uuid | "exempt" }]. Price comes from the order line, never from the
-- caller. When the company is VAT registered each line's rate is the one given, else the item's default VAT rate, else the company
-- default; "exempt" means no VAT on that line. When it is not, a rate is refused and every line has none.
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

-- ---------------------------------------------------------------- notes with VAT (sql/037's function, plus the invoice line's rate)

-- p_lines: [{ "invoiceLineId": uuid, "qty": number, "unitPriceMinor": number (optional, before VAT) }]. Each note line takes the
-- invoice line's VAT rate; its tax is recomputed on the note's quantity and price. total_minor = gross (net + VAT).
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
    v_valid := v_valid || jsonb_build_array(jsonb_build_object('line', il.id, 'qty', r.qty, 'price', v_price, 'rateId', il.tax_rate_id, 'rate', il.tax_rate));
    -- same maths as sal__line_tax (the trigger writes the stored figures; the check below proves they agree)
    v_lnet := round(r.qty * v_price)::bigint;
    v_net := v_net + v_lnet;
    v_tax := v_tax + round(v_lnet * il.tax_rate / 100)::bigint;
  end loop;

  insert into public.inv_counters (org_id, key, value) values (v_org, case p_kind when 'credit' then 'sales_credit_note' else 'sales_debit_note' end, 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  v_number := case p_kind when 'credit' then 'CN-' else 'DN-' end || lpad(v_n::text, 4, '0');

  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, net_minor, tax_minor, gross_minor, requester_id)
  values (v_id, v_org, v_number, p_kind, inv.id, inv.customer_id, inv.currency, trim(p_reason), v_net + v_tax, v_net, v_tax, v_net + v_tax, auth.uid());
  for e in select x from jsonb_array_elements(v_valid) x loop
    insert into public.sal_note_lines (org_id, note_id, invoice_line_id, qty, unit_price_minor, tax_rate_id, tax_rate)
    values (v_org, v_id, (e ->> 'line')::uuid, (e ->> 'qty')::numeric, (e ->> 'price')::bigint, (e ->> 'rateId')::uuid, (e ->> 'rate')::numeric);
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

-- ---------------------------------------------------------------- accounts and roles

alter table public.acc_account_roles drop constraint if exists acc_account_roles_role_key_check;
alter table public.acc_account_roles add constraint acc_account_roles_role_key_check check (role_key in (
  'inventory', 'receivables', 'cash', 'bank', 'card_clearing', 'cheque_in_clearing', 'cheque_out_clearing', 'other_clearing',
  'opening_balance', 'payables', 'grni', 'expense_payables', 'expense_default', 'stock_adjustment', 'internal_use',
  'price_variance', 'cogs', 'sales_revenue', 'sales_returns', 'output_vat', 'input_vat'));

-- Adds the VAT accounts and points the two roles at them, for a company that has a chart. A role already set is left alone; an account
-- with the code already there is used if it is an active leaf. Parent 18 is created under 1 when missing. Returns accounts added.
create or replace function public.acc__ensure_vat_accounts(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_parent uuid; v_id uuid; v_n int := 0;
begin
  if not exists (select 1 from public.acc_accounts where org_id = p_org and deleted_at is null) then return 0; end if;
  if not exists (select 1 from public.acc_accounts where org_id = p_org and code = '18' and deleted_at is null)
     and not exists (select 1 from public.acc_account_roles where org_id = p_org and role_key = 'input_vat') then
    select id into v_parent from public.acc_accounts where org_id = p_org and code = '1' and deleted_at is null;
    insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
    values (p_org, '18', 'Current financial investments and other debit balances', 'استثمارات مالية متداولة وأرصدة مدينة أخرى', v_parent, 'asset', auth.uid());
    v_n := v_n + 1;
  end if;
  for r in select * from (values
      ('output_vat', '2871', '28', 'liability', 'Output VAT payable',     'ضريبة القيمة المضافة على المبيعات (مستحقة)'),
      ('input_vat',  '1811', '18', 'asset',     'Input VAT recoverable',  'ضريبة القيمة المضافة على المشتريات (قابلة للخصم)')
    ) as t(role_key, code, parent_code, kind, name, name_ar)
  loop
    continue when exists (select 1 from public.acc_account_roles where org_id = p_org and role_key = r.role_key);
    select id into v_id from public.acc_accounts a where a.org_id = p_org and a.code = r.code and a.deleted_at is null;
    if v_id is null then
      select id into v_parent from public.acc_accounts where org_id = p_org and code = r.parent_code and deleted_at is null;
      insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
      values (p_org, r.code, r.name, r.name_ar, v_parent, r.kind, auth.uid()) returning id into v_id;
      v_n := v_n + 1;
    elsif not exists (select 1 from public.acc_accounts a where a.id = v_id and a.active)
       or exists (select 1 from public.acc_accounts c where c.org_id = p_org and c.parent_id = v_id and c.deleted_at is null) then
      continue;   -- the code is taken by an inactive or parent account: the role stays unset for the company to choose
    end if;
    insert into public.acc_account_roles (org_id, role_key, account_id) values (p_org, r.role_key, v_id) on conflict (org_id, role_key) do nothing;
  end loop;
  return v_n;
end $$;
revoke all on function public.acc__ensure_vat_accounts(uuid) from public, anon, authenticated;

-- New charts get them too: sql/045's seed runs first, then the VAT accounts.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'acc__seed_chart_base' and pronamespace = 'public'::regnamespace) then
    alter function public.acc__seed_chart(uuid) rename to acc__seed_chart_base;
  end if;
end $$;
create or replace function public.acc__seed_chart(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  v_n := public.acc__seed_chart_base(p_org);
  if v_n = 0 then return 0; end if;   -- the company already had a chart: unchanged behaviour
  return v_n + public.acc__ensure_vat_accounts(p_org);
end $$;
revoke all on function public.acc__seed_chart(uuid), public.acc__seed_chart_base(uuid) from public, anon, authenticated;

-- Every company that already has a chart, audited per company that gained something.
do $$
declare o record; v int;
begin
  for o in select distinct a.org_id from public.acc_accounts a where a.deleted_at is null loop
    v := public.acc__ensure_vat_accounts(o.org_id);
    if v > 0 then
      insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
      values (o.org_id, null, 'accounting.chart.vat_accounts_added', 'organization', o.org_id::text,
              format('VAT accounts added to the chart (%s account(s)): 2871 Output VAT payable, 1811 Input VAT recoverable', v),
              jsonb_build_object('accounts', v));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- posting with VAT (sql/046's two functions)

create or replace function public.acc__post_sal_invoice(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.sal_invoices;
begin
  select * into i from public.sal_invoices where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.gross_minor = 0 then return null; end if;
  return public.acc__post(p_org, i.invoice_date, i.currency, 'customer_invoice', i.id::text, 'invoiced', 'Customer invoice ' || i.number,
    jsonb_build_array(
      jsonb_build_object('role', 'receivables', 'debit', i.gross_minor, 'partyType', 'customer', 'partyId', i.customer_id),
      jsonb_build_object('role', 'sales_revenue', 'credit', i.net_minor, 'partyType', 'customer', 'partyId', i.customer_id),
      jsonb_build_object('role', 'output_vat', 'credit', i.tax_minor)),
    p_backfill);
end $$;

create or replace function public.acc__post_note(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare n public.sal_notes; v_lines jsonb;
begin
  select * into n from public.sal_notes where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if n.status <> 'approved' or n.gross_minor = 0 then return null; end if;
  if n.kind = 'credit' then
    v_lines := jsonb_build_array(
      jsonb_build_object('role', 'sales_returns', 'debit', n.net_minor, 'partyType', 'customer', 'partyId', n.customer_id),
      jsonb_build_object('role', 'output_vat', 'debit', n.tax_minor),
      jsonb_build_object('role', 'receivables', 'credit', n.gross_minor, 'partyType', 'customer', 'partyId', n.customer_id));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('role', 'receivables', 'debit', n.gross_minor, 'partyType', 'customer', 'partyId', n.customer_id),
      jsonb_build_object('role', 'sales_revenue', 'credit', n.net_minor, 'partyType', 'customer', 'partyId', n.customer_id),
      jsonb_build_object('role', 'output_vat', 'credit', n.tax_minor));
  end if;
  return public.acc__post(p_org, public.acc__local_date(p_org, coalesce(n.decided_at, now())), n.currency, 'sales_note', n.id::text,
    case when n.kind = 'credit' then 'credited' else 'debited' end, initcap(n.kind) || ' note ' || n.number, v_lines, p_backfill);
end $$;
revoke all on function public.acc__post_sal_invoice(uuid, uuid, boolean), public.acc__post_note(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- amount owed everywhere it is computed
-- The four functions below are their latest versions (sql/051, sql/027, sql/041, sql/070) with only the invoice total replaced by
-- sal__invoice_due / sal__invoice_owed (gross, net of approved notes).

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
      select coalesce(sum(round(l.qty * l.unit_cost_minor)), 0)::bigint into v_total from public.pur_supplier_invoice_lines l where l.org_id = v_org and l.invoice_id = p_supplier_invoice_id;
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
    select (select coalesce(sum(round(l.qty * l.unit_cost_minor)), 0) from public.pur_supplier_invoice_lines l where l.org_id = i.org_id and l.invoice_id = i.id)::bigint as total,
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

create or replace function public.alr_run(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; c record; f public.alr_firings%rowtype; rcp record;
  v_lines text[]; v_n int; v_first text; v_title text; v_body text;
  v_fire boolean; v_worse boolean; v_sent int; n_rules int := 0; n_alerts int := 0; n_msgs int := 0; org_alerts int; v_org uuid;
  m0 date := date_trunc('month', current_date)::date; v_rev bigint; v_cogs bigint; v_exp bigint;
begin
  for v_org in
    select o.id from public.organizations o
     where o.deleted_at is null and (p_org is null or o.id = p_org)
       and exists (select 1 from public.org_modules mo where mo.org_id = o.id and mo.module_key = 'alerts' and mo.disabled_at is null)
  loop
    org_alerts := 0;
    for r in select * from public.alr_rules where alr_rules.org_id = v_org and enabled and deleted_at is null loop
      n_rules := n_rules + 1;

      v_lines := '{}'; v_n := 0; v_first := null;
      -- candidates: subject key, current value, whether a larger value is worse (or a smaller one), message text
      for c in
        select * from (
          select 'item:' || it.id as subject, coalesce(sum(b.on_hand - b.reserved), 0) as val, false as bigger_is_worse,
                 format('%s %s: %s available (alert level %s)', it.sku, it.name, coalesce(sum(b.on_hand - b.reserved), 0), coalesce(r.threshold, it.reorder_level)) as txt,
                 'Low stock: ' || it.sku as title
            from public.inv_items it left join public.inv_stock_balances b on b.org_id = it.org_id and b.item_id = it.id
           where r.kind = 'stock_below' and it.org_id = r.org_id and it.deleted_at is null and (r.item_id is null or it.id = r.item_id)
           group by it.id, it.sku, it.name, it.reorder_level
          having coalesce(r.threshold, it.reorder_level) is not null and coalesce(sum(b.on_hand - b.reserved), 0) <= coalesce(r.threshold, it.reorder_level)
          union all
          select 'batch:' || b.id, (b.expiry_date - current_date)::numeric, false,
                 format('%s %s batch %s: %s in stock, %s', it.sku, it.name, b.batch_no, sum(bb.qty),
                        case when b.expiry_date < current_date then 'EXPIRED ' || (current_date - b.expiry_date) || ' day(s) ago' else 'expires in ' || (b.expiry_date - current_date) || ' day(s)' end),
                 case when b.expiry_date < current_date then 'Expired stock: ' else 'Expiring stock: ' end || it.sku
            from public.inv_batches b join public.inv_items it on it.org_id = b.org_id and it.id = b.item_id join public.inv_batch_balances bb on bb.org_id = b.org_id and bb.batch_id = b.id
           where r.kind = 'expiry_within' and b.org_id = r.org_id and b.expiry_date is not null and b.expiry_date <= current_date + r.threshold::int
           group by b.id, b.batch_no, b.expiry_date, it.sku, it.name having sum(bb.qty) > 0
          union all
          select 'invoice:' || t.id, t.remaining::numeric, true,
                 format('Invoice %s for %s is unpaid %s day(s) after its due date %s: %s %s still owed', t.number, t.cname, current_date - t.due_date, t.due_date, round(t.remaining / 100.0, 2), t.currency),
                 'Overdue invoice ' || t.number
            from (select i.id, i.number, i.invoice_date, i.due_date, i.currency, cu.name as cname,
                         public.sal__invoice_due(i.org_id, i.id)
                         - coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = i.org_id and p.customer_invoice_id = i.id and p.status = 'recorded'), 0)::bigint as remaining
                    from public.sal_invoices i join public.sal_customers cu on cu.org_id = i.org_id and cu.id = i.customer_id
                   where r.kind = 'receivable_overdue' and i.org_id = r.org_id and i.status = 'issued' and i.due_date < current_date - r.threshold::int) t
           where t.remaining > 0
          union all
          select 'fc:' || fc.item_id, fc.days_of_cover::numeric, false,
                 format('%s %s: about %s day(s) left (runs out around %s); %s available, using %s a day; %s%s',
                        fc.sku, fc.name, fc.days_of_cover, fc.runs_out_on, fc.available, fc.daily_rate,
                        case fc.confidence when 'good' then 'solid history' else 'THIN history, treat as a guess' end,
                        case when coalesce(fc.suggested_order, 0) > 0 then '; suggested order ' || fc.suggested_order else '' end),
                 'Running out soon: ' || fc.sku
            from public.inv__forecast_for(r.org_id) fc
           where r.kind = 'forecast_stockout' and fc.confidence <> 'none' and fc.days_of_cover <= r.threshold::int and (r.item_id is null or fc.item_id = r.item_id)
        ) q
      loop
        select * into f from public.alr_firings where rule_id = r.id and subject = c.subject;
        v_worse := f.rule_id is not null and ((c.bigger_is_worse and c.val > f.last_value) or (not c.bigger_is_worse and r.kind = 'stock_below' and c.val < f.last_value));
        v_fire := f.rule_id is null or f.last_fired_at <= now() - make_interval(hours => r.repeat_hours) or (v_worse and f.last_fired_at <= now() - interval '1 hour');
        continue when not v_fire;
        -- everything that is due goes into ONE message per person (a digest), never one message per item or invoice
        v_n := v_n + 1;
        if v_n <= 10 then v_lines := v_lines || c.txt; end if;
        v_first := coalesce(v_first, c.title);
        insert into public.alr_firings (org_id, rule_id, subject, last_fired_at, last_value, times) values (r.org_id, r.id, c.subject, now(), c.val, 1)
        on conflict (rule_id, subject) do update set last_fired_at = now(), last_value = excluded.last_value, times = public.alr_firings.times + 1;
      end loop;
      if v_n > 0 then
        v_title := case when v_n = 1 then v_first
                        else case r.kind when 'stock_below' then 'Low stock: ' || v_n || ' items' when 'expiry_within' then 'Expiring stock: ' || v_n || ' batches' when 'forecast_stockout' then 'Running out soon: ' || v_n || ' items' else 'Overdue invoices: ' || v_n end end;
        v_body := array_to_string(v_lines, E'\n') || case when v_n > 10 then E'\n...and ' || (v_n - 10) || ' more' else '' end;
        v_sent := 0;
        for rcp in select * from public.alr__recipients(r.org_id, r.id) loop
          if public.msg__enqueue(r.org_id, rcp.user_id, 'alert', v_title, v_body, null, null, 'alr:' || r.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000000)::bigint || ':' || rcp.user_id) is not null then v_sent := v_sent + 1; end if;
        end loop;
        n_alerts := n_alerts + v_n; org_alerts := org_alerts + v_n; n_msgs := n_msgs + v_sent;
      end if;

      -- profit so far this month (sales - cost of goods - expenses) below zero
      if r.kind = 'profit_negative' then
        select coalesce(sum(round(il.qty * il.unit_price_minor)), 0)::bigint into v_rev from public.sal_invoices i join public.sal_invoice_lines il on il.org_id = i.org_id and il.invoice_id = i.id
         where i.org_id = r.org_id and i.status = 'issued' and i.invoice_date >= m0;
        select coalesce(sum(round(-mv.qty * coalesce(mv.unit_cost_minor, it.avg_cost_minor))), 0)::bigint into v_cogs from public.inv_stock_moves mv join public.inv_items it on it.org_id = mv.org_id and it.id = mv.item_id
         where mv.org_id = r.org_id and mv.kind = 'issue' and mv.posted_at >= m0 and mv.request_id in (select so.request_id from public.sal_orders so where so.org_id = r.org_id and so.request_id is not null);
        select coalesce(sum(e.amount_minor), 0)::bigint into v_exp from public.fin_expenses e where e.org_id = r.org_id and e.status = 'recorded' and e.expense_date >= m0;
        if v_rev - v_cogs - v_exp < 0 then
          select * into f from public.alr_firings where rule_id = r.id and subject = 'month:' || to_char(m0, 'YYYY-MM');
          v_worse := f.rule_id is not null and (v_rev - v_cogs - v_exp) < f.last_value;
          if f.rule_id is null or f.last_fired_at <= now() - make_interval(hours => r.repeat_hours) or (v_worse and f.last_fired_at <= now() - interval '1 hour') then
            v_sent := 0;
            for rcp in select * from public.alr__recipients(r.org_id, r.id) loop
              if public.msg__enqueue(r.org_id, rcp.user_id, 'alert', 'Losing money this month',
                   format('This month so far: sales %s, cost of goods %s, expenses %s: a loss of %s %s.', round(v_rev / 100.0), round(v_cogs / 100.0), round(v_exp / 100.0), round(-(v_rev - v_cogs - v_exp) / 100.0),
                          (select default_currency from public.organizations where id = r.org_id)), null, null, 'alr:' || r.id || ':month:' || (coalesce(f.times, 0) + 1) || ':' || rcp.user_id) is not null then v_sent := v_sent + 1; end if;
            end loop;
            insert into public.alr_firings (org_id, rule_id, subject, last_fired_at, last_value, times) values (r.org_id, r.id, 'month:' || to_char(m0, 'YYYY-MM'), now(), v_rev - v_cogs - v_exp, 1)
            on conflict (rule_id, subject) do update set last_fired_at = now(), last_value = excluded.last_value, times = public.alr_firings.times + 1;
            n_alerts := n_alerts + 1; org_alerts := org_alerts + 1; n_msgs := n_msgs + v_sent;
          end if;
        end if;
      end if;
    end loop;

    if org_alerts > 0 then
      insert into public.audit_log (org_id, action, entity_type, summary, metadata)
      values (v_org, 'alerts.run', 'organization', format('Alert rules fired %s time(s)', org_alerts), jsonb_build_object('fired', org_alerts));
    end if;
  end loop;
  return jsonb_build_object('rules', n_rules, 'alerts', n_alerts, 'messages', n_msgs);
end $$;

create or replace function public.core_report_link_rows(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l       public.core_report_links;
  v_mod   text;
  v_cols  jsonb;
  v_rows  jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND'; end if;
  select * into l from public.core_report_links where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and deleted_at is null for update;
  if not found or l.revoked_at is not null or (l.expires_at is not null and l.expires_at <= now()) then raise exception 'NOT_FOUND'; end if;
  v_mod := case l.report when 'stock_on_hand' then 'inventory' else 'sales' end;
  if not exists (select 1 from public.org_modules m where m.org_id = l.org_id and m.module_key = v_mod and m.disabled_at is null) then
    raise exception 'NOT_FOUND';
  end if;

  if l.report = 'stock_on_hand' then
    v_cols := '["Item code","Item name","Warehouse","Quantity","Unit"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_array(s.sku, s.item_name, s.warehouse, s.qty, s.uom) order by s.sku, s.warehouse), '[]'::jsonb) into v_rows
    from (select i.sku, i.name as item_name, w.name as warehouse, trim_scale(b.on_hand)::text as qty, i.uom
          from public.inv_stock_balances b
          join public.inv_items i on i.org_id = b.org_id and i.id = b.item_id and i.deleted_at is null
          join public.inv_warehouses w on w.org_id = b.org_id and w.id = b.warehouse_id and w.deleted_at is null
          where b.org_id = l.org_id and b.on_hand > 0
          order by i.sku, w.name limit 5000) s;
  elsif l.report = 'open_invoices' then
    v_cols := '["Number","Date","Due date","Customer","Currency","Total","Paid","Left"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_array(s.number, s.invoice_date, s.due_date, s.customer, s.currency,
             public.core__minor_text(s.total, s.currency), public.core__minor_text(s.paid, s.currency), public.core__minor_text(s.total - s.paid, s.currency))
             order by s.due_date, s.number), '[]'::jsonb) into v_rows
    from (select v.number, v.invoice_date, v.due_date, c.name as customer, v.currency::text as currency, v.total, v.paid
          from (select inv.number, inv.invoice_date, inv.due_date, inv.customer_id, inv.currency,
                       public.sal__invoice_due(inv.org_id, inv.id) as total,
                       coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = inv.org_id and p.customer_invoice_id = inv.id and p.status = 'recorded'), 0)::bigint as paid
                from public.sal_invoices inv where inv.org_id = l.org_id and inv.status = 'issued') v
          join public.sal_customers c on c.org_id = l.org_id and c.id = v.customer_id
          where v.total - v.paid > 0
          order by v.due_date, v.number limit 5000) s;
  else
    v_cols := '["Month","Currency","Invoices","Total"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_array(s.month, s.currency, s.n, public.core__minor_text(s.total, s.currency)) order by s.month, s.currency), '[]'::jsonb) into v_rows
    from (select to_char(v.invoice_date, 'YYYY-MM') as month, v.currency::text as currency, count(*) as n, sum(v.total)::bigint as total
          from (select inv.invoice_date, inv.currency,
                       coalesce((select sum(round(ln.qty * ln.unit_price_minor)) from public.sal_invoice_lines ln where ln.org_id = inv.org_id and ln.invoice_id = inv.id), 0)::bigint as total
                from public.sal_invoices inv where inv.org_id = l.org_id and inv.status = 'issued') v
          group by 1, 2 order by 1, 2 limit 5000) s;
  end if;

  update public.core_report_links set last_read_at = now(), read_count = read_count + 1 where id = l.id;
  return jsonb_build_object('report', l.report, 'columns', v_cols, 'rows', v_rows);
end $$;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- Expect: 0 invoices whose stored totals differ from their lines; 0 notes whose total differs from gross; 0 lines without net.
select (select count(*) from public.sal_invoices i
          left join (select l.org_id, l.invoice_id, sum(l.net_minor) as net, sum(l.tax_minor) as tax from public.sal_invoice_lines l group by 1, 2) s
            on s.org_id = i.org_id and s.invoice_id = i.id
         where i.net_minor <> coalesce(s.net, 0) or i.tax_minor <> coalesce(s.tax, 0)) as invoices_off,
       (select count(*) from public.sal_notes where total_minor <> gross_minor) as notes_off,
       (select count(*) from public.sal_invoice_lines where net_minor is null) + (select count(*) from public.sal_note_lines where net_minor is null) as lines_without_net;
-- Expect: every company with a chart has both VAT roles (missing_vat_roles = 0, unless a company's 2871/1811 code is taken by another account).
select count(*) as companies_missing_vat_roles from (select distinct org_id from public.acc_accounts where deleted_at is null) o
 where (select count(*) from public.acc_account_roles r where r.org_id = o.org_id and r.role_key in ('output_vat', 'input_vat')) < 2;
-- Expect: users can set VAT (true), anonymous cannot (false); the helpers are closed to users (false).
select has_function_privilege('authenticated', 'public.core_set_vat(boolean, uuid)', 'execute') as users_can_set_vat,
       has_function_privilege('anon', 'public.core_set_vat(boolean, uuid)', 'execute') as anon_can_set_vat,
       has_function_privilege('authenticated', 'public.sal__invoice_owed(uuid, uuid)', 'execute') as users_can_call_owed_helper;
