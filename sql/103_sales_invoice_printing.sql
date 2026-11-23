-- 103_sales_invoice_printing.sql
-- Invoice printing, step 1c (documentation/plans/INVOICE_PRINTING_PLAN.md; Ben's decisions of 23 Nov 2026). Rerun-safe. Needs sql/001-102.
-- Run the whole file, then sql/tests/100_sales_invoice_printing.sql.
--
-- 1. Numbers per document type and year: INV-2026-00001, CN-2026-00001, DN-2026-00001. A new sequence starts each year. The year is the
--    invoice date's year (a note: the company's local date when it is asked for). Numbers given before this migration stay as they are.
--    sal_create_invoice and sal_submit_note are their latest versions (sql/093) with only the number lines changed (copied by script).
-- 2. Drafts: a draft invoice lives in its own table (sal_invoice_drafts), not in sal_invoices. So every report, VAT return, statement,
--    payment and posting that reads sal_invoices sees issued invoices only, exactly as before. A draft has no number and posts nothing.
--    "Issue" runs sal_create_invoice with the draft's lines (all of today's checks), so the number is given only at issue (no gaps).
-- 3. Issued = locked forever: a trigger refuses any change to an issued invoice except voiding it, and refuses deleting it or its lines.
--    A mistake is corrected with a credit or debit note (ETA's rule and ours).
-- 4. Company document settings (core_doc_settings): logo, letterhead, margins, header, footer, bank details, payment terms, language
--    (Arabic by default), digits (Western by default), layout, and how "Send" works (the person's own device, or our queue).
--    Images are kept in the database as data: addresses (PNG, JPEG or WebP only; never SVG), logo up to about 300 KB, letterhead 1.5 MB.
-- 5. Invoice links (sal_doc_links): a private link to one issued invoice or approved note. It works until the invoice is voided (or the
--    note stops being approved), or until someone switches it off. No end date. The public read (sal_doc_link_print) is granted to anon:
--    the token is the only credential; every refusal is the same NOT_FOUND. Unlike sql/070 the token is kept (not only its hash), so the
--    same link can be sent again; the table has no grants at all, and the token is returned only by sal_doc_link to a signed-in member
--    of the same company who may send (owner, admin, member), who can already read the invoice itself.
-- 6. Send records (core_doc_sends, append-only): who sent which document, how, to whom. No PDF fingerprint: the PDF is made in the
--    person's browser for now, so the server cannot vouch for its bytes (added with the server converter later).
-- 7. One print builder (sal__doc_print_data) for drafts, invoices and notes, used by the signed-in print and by the public link.
-- Every write is a security-definer function with its audit row in the same transaction (ADR-0003).

begin;

-- ================================================================ 1. numbers per type and year

create or replace function public.sal__doc_number(p_org uuid, p_kind text, p_date date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text := case p_kind when 'invoice' then 'INV' when 'credit' then 'CN' when 'debit' then 'DN' end;
  v_year   int;
  v_n      bigint;
begin
  if v_prefix is null or p_org is null or p_date is null then raise exception 'INVALID_INPUT'; end if;
  v_year := extract(year from p_date)::int;
  insert into public.inv_counters (org_id, key, value) values (p_org, format('sales_%s:%s', p_kind, v_year), 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  return format('%s-%s-%s', v_prefix, v_year, lpad(v_n::text, 5, '0'));
end $$;
revoke all on function public.sal__doc_number(uuid, text, date) from public, anon, authenticated;

-- The two functions below are their latest versions (sql/093) with only the number lines changed (copied and checked by script).

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

  -- sql/103: one sequence per type and year (INV-2026-00001); the year is the invoice date's
  v_no := public.sal__doc_number(v_org, 'invoice', p_invoice_date);

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

  -- sql/103: one sequence per type and year (CN-2026-00001, DN-2026-00001); the year is the company's local date today
  v_number := public.sal__doc_number(v_org, p_kind, public.acc__local_date(v_org, now()));

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

revoke all on function public.sal_create_invoice(uuid, date, jsonb), public.sal_submit_note(uuid, text, text, jsonb) from public, anon;
grant execute on function public.sal_create_invoice(uuid, date, jsonb), public.sal_submit_note(uuid, text, text, jsonb) to authenticated;

-- ================================================================ 3. issued invoices are locked

create or replace function public.sal__invoice_issued_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  -- A database-owner session only (a migration that must correct data, or a test fixture): never the app. PostgREST connects as
  -- authenticator (so session_user is never 'postgres' for a signed-in or anonymous caller), the statement must not run as an app role,
  -- and users cannot write this table at all. Proved in sql/tests/100 (P3h).
  if session_user = 'postgres' and current_user not in ('authenticated', 'anon', 'authenticator', 'service_role')
     and current_setting('erp.allow_issued_fix', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'INVALID_STATE' using detail = 'an issued invoice is never deleted: void it, or make a credit note';
  end if;
  if (new.id, new.org_id, new.number, new.order_id, new.customer_id, new.invoice_date, new.currency, new.created_by, new.created_at)
     is distinct from (old.id, old.org_id, old.number, old.order_id, old.customer_id, old.invoice_date, old.currency, old.created_by, old.created_at) then
    raise exception 'INVALID_STATE' using detail = 'an issued invoice cannot be changed: make a credit or debit note';
  end if;
  if old.status = 'void' and new.status is distinct from 'void' then
    raise exception 'INVALID_STATE' using detail = 'a void invoice stays void';
  end if;
  return new;
end $$;
revoke all on function public.sal__invoice_issued_lock() from public, anon, authenticated;
drop trigger if exists sal_invoices_issued_lock on public.sal_invoices;
create trigger sal_invoices_issued_lock before update or delete on public.sal_invoices
  for each row execute function public.sal__invoice_issued_lock();

create or replace function public.sal__invoice_lines_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if session_user = 'postgres' and current_user not in ('authenticated', 'anon', 'authenticator', 'service_role')
     and current_setting('erp.allow_issued_fix', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'INVALID_STATE' using detail = 'the lines of an issued invoice cannot be changed: make a credit or debit note';
end $$;
revoke all on function public.sal__invoice_lines_lock() from public, anon, authenticated;
drop trigger if exists sal_invoice_lines_issued_lock on public.sal_invoice_lines;
create trigger sal_invoice_lines_issued_lock before update or delete on public.sal_invoice_lines
  for each row execute function public.sal__invoice_lines_lock();

-- ================================================================ 2. draft invoices

create table if not exists public.sal_invoice_drafts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  order_id     uuid not null,
  customer_id  uuid not null,
  invoice_date date not null,
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status       text not null default 'draft' check (status in ('draft', 'issued', 'discarded')),
  invoice_id   uuid,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  issued_by    uuid references auth.users(id),
  issued_at    timestamptz,
  deleted_at   timestamptz,
  unique (org_id, id),
  foreign key (org_id, order_id) references public.sal_orders (org_id, id),
  foreign key (org_id, customer_id) references public.sal_customers (org_id, id),
  foreign key (org_id, invoice_id) references public.sal_invoices (org_id, id),
  constraint sal_invoice_drafts_issued_has_invoice check (status <> 'issued' or (invoice_id is not null and issued_at is not null))
);
create index if not exists sal_invoice_drafts_org_idx on public.sal_invoice_drafts (org_id, status, created_at desc);
create unique index if not exists sal_invoice_drafts_invoice_uq on public.sal_invoice_drafts (org_id, invoice_id) where invoice_id is not null;

create table if not exists public.sal_invoice_draft_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  draft_id      uuid not null,
  order_line_id uuid not null,
  qty           numeric(18, 3) not null check (qty > 0),
  -- The VAT choice as the person made it: null = the item's or the company's default; 'exempt'; or one of the company's rate ids.
  tax_choice    text check (tax_choice is null or tax_choice = 'exempt' or tax_choice ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  created_at    timestamptz not null default now(),
  unique (draft_id, order_line_id),
  foreign key (org_id, draft_id) references public.sal_invoice_drafts (org_id, id),
  foreign key (org_id, order_line_id) references public.sal_order_lines (org_id, id)
);
create index if not exists sal_invoice_draft_lines_org_draft_idx on public.sal_invoice_draft_lines (org_id, draft_id);

drop trigger if exists sal_invoice_drafts_updated_at on public.sal_invoice_drafts;
create trigger sal_invoice_drafts_updated_at before update on public.sal_invoice_drafts for each row execute function public.set_updated_at();

-- An issued or discarded draft never changes again (the functions below already refuse; this is the second lock).
create or replace function public.sal__invoice_draft_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'INVALID_STATE' using detail = 'drafts are discarded, not deleted'; end if;
  if old.status <> 'draft' then raise exception 'INVALID_STATE' using detail = 'this draft was already issued or discarded'; end if;
  if (new.id, new.org_id, new.order_id, new.customer_id, new.created_by, new.created_at)
     is distinct from (old.id, old.org_id, old.order_id, old.customer_id, old.created_by, old.created_at) then
    raise exception 'INVALID_STATE' using detail = 'a draft keeps its order';
  end if;
  return new;
end $$;
revoke all on function public.sal__invoice_draft_guard() from public, anon, authenticated;
drop trigger if exists sal_invoice_drafts_guard on public.sal_invoice_drafts;
create trigger sal_invoice_drafts_guard before update or delete on public.sal_invoice_drafts
  for each row execute function public.sal__invoice_draft_guard();

alter table public.sal_invoice_drafts enable row level security;
alter table public.sal_invoice_draft_lines enable row level security;
revoke all on public.sal_invoice_drafts, public.sal_invoice_draft_lines from anon, authenticated;
grant select on public.sal_invoice_drafts, public.sal_invoice_draft_lines to authenticated;
drop policy if exists sal_invoice_drafts_member_read on public.sal_invoice_drafts;
create policy sal_invoice_drafts_member_read on public.sal_invoice_drafts for select to authenticated using (public.is_org_member(org_id));
drop policy if exists sal_invoice_draft_lines_member_read on public.sal_invoice_draft_lines;
create policy sal_invoice_draft_lines_member_read on public.sal_invoice_draft_lines for select to authenticated using (public.is_org_member(org_id));

-- Save a draft: a new one (p_draft_id null) or the same draft again (its lines are replaced). Owners and admins, like issuing.
-- p_lines: [{ "orderLineId": uuid, "qty": number, "taxRateId": uuid | "exempt" (optional) }]. The same order line twice is added up.
-- The quantity is checked against what is still left to invoice now; it is checked again at issue.
create or replace function public.sal_save_invoice_draft(p_draft_id uuid, p_order_id uuid, p_invoice_date date, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.sal__guard(array['owner', 'admin']);
  o        public.sal_orders%rowtype;
  d        public.sal_invoice_drafts%rowtype;
  v_rs     text;
  v_id     uuid;
  e        jsonb;
  v_line   uuid;
  v_qty    numeric;
  v_choice text;
  r        record;
  v_billed numeric;
  v_new    boolean := p_draft_id is null;
begin
  if p_order_id is null or p_invoice_date is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INPUT';
  end if;
  select * into o from public.sal_orders where org_id = v_org and id = p_order_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' or o.request_id is null then raise exception 'NOT_DELIVERED'; end if;
  select q.status into v_rs from public.inv_requests q where q.org_id = v_org and q.id = o.request_id;
  if v_rs is distinct from 'issued' then raise exception 'NOT_DELIVERED'; end if;

  if v_new then
    insert into public.sal_invoice_drafts (org_id, order_id, customer_id, invoice_date, currency, created_by)
    values (v_org, o.id, o.customer_id, p_invoice_date, o.currency, auth.uid()) returning id into v_id;
  else
    select * into d from public.sal_invoice_drafts where org_id = v_org and id = p_draft_id and deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if d.status <> 'draft' then raise exception 'INVALID_STATE' using detail = 'this draft was already issued or discarded'; end if;
    if d.order_id <> o.id then raise exception 'INVALID_INPUT' using detail = 'a draft keeps its order'; end if;
    update public.sal_invoice_drafts set invoice_date = p_invoice_date where id = d.id;
    delete from public.sal_invoice_draft_lines where org_id = v_org and draft_id = d.id;
    v_id := d.id;
  end if;

  for e in select value from jsonb_array_elements(p_lines) loop
    begin
      v_line := (e ->> 'orderLineId')::uuid;
      v_qty := (e ->> 'qty')::numeric;
    exception when others then raise exception 'INVALID_INPUT'; end;
    v_choice := nullif(trim(coalesce(e ->> 'taxRateId', '')), '');
    if v_line is null or v_qty is null or v_qty <= 0 then raise exception 'INVALID_INPUT'; end if;
    if v_choice is not null and v_choice <> 'exempt' and v_choice !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'INVALID_INPUT' using detail = 'taxRateId must be a rate id or "exempt"';
    end if;
    if not exists (select 1 from public.sal_order_lines l where l.org_id = v_org and l.order_id = o.id and l.id = v_line) then
      raise exception 'INVALID_INPUT' using detail = 'that line is not on the order';
    end if;
    insert into public.sal_invoice_draft_lines (org_id, draft_id, order_line_id, qty, tax_choice)
    values (v_org, v_id, v_line, v_qty, v_choice)
    on conflict (draft_id, order_line_id) do update set qty = public.sal_invoice_draft_lines.qty + excluded.qty,
      tax_choice = coalesce(excluded.tax_choice, public.sal_invoice_draft_lines.tax_choice);
  end loop;

  -- Not more than is left to invoice (issued invoices only; other drafts do not reserve anything).
  for r in select dl.order_line_id, dl.qty, l.qty as ordered from public.sal_invoice_draft_lines dl
             join public.sal_order_lines l on l.org_id = dl.org_id and l.id = dl.order_line_id
            where dl.org_id = v_org and dl.draft_id = v_id loop
    select coalesce(sum(il.qty), 0) into v_billed
      from public.sal_invoice_lines il join public.sal_invoices i on i.org_id = il.org_id and i.id = il.invoice_id
     where il.org_id = v_org and il.order_line_id = r.order_line_id and i.status = 'issued';
    if v_billed + r.qty > r.ordered then raise exception 'INVOICE_QTY_EXCEEDS_DELIVERED'; end if;
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when v_new then 'sales.invoice_draft.created' else 'sales.invoice_draft.saved' end, 'sales_invoice_draft', v_id::text,
          format('Draft invoice for %s, dated %s, %s line(s)', o.number, p_invoice_date,
                 (select count(*) from public.sal_invoice_draft_lines x where x.org_id = v_org and x.draft_id = v_id)));
  return jsonb_build_object('id', v_id, 'status', 'draft');
end $$;

create or replace function public.sal_discard_invoice_draft(p_draft_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin']);
  d     public.sal_invoice_drafts%rowtype;
  v_no  text;
begin
  select * into d from public.sal_invoice_drafts where org_id = v_org and id = p_draft_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if d.status <> 'draft' then raise exception 'INVALID_STATE' using detail = 'this draft was already issued or discarded'; end if;
  update public.sal_invoice_drafts set status = 'discarded', deleted_at = now() where id = d.id;
  select o.number into v_no from public.sal_orders o where o.org_id = v_org and o.id = d.order_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.invoice_draft.discarded', 'sales_invoice_draft', d.id::text, format('Draft invoice for %s discarded', v_no));
end $$;

-- Issue: the draft becomes a real invoice through sal_create_invoice (every check of today: delivered, quantities, VAT, Shopify, lock
-- date), which gives the number. The draft keeps a link to the invoice and never changes again.
create or replace function public.sal_issue_invoice_draft(p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.sal__guard(array['owner', 'admin']);
  d       public.sal_invoice_drafts%rowtype;
  v_lines jsonb;
  v_made  jsonb;
begin
  select * into d from public.sal_invoice_drafts where org_id = v_org and id = p_draft_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if d.status <> 'draft' then raise exception 'INVALID_STATE' using detail = 'this draft was already issued or discarded'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderLineId', l.order_line_id, 'qty', l.qty)
                            || case when l.tax_choice is null then '{}'::jsonb else jsonb_build_object('taxRateId', l.tax_choice) end
                            order by l.created_at, l.id), '[]'::jsonb)
    into v_lines from public.sal_invoice_draft_lines l where l.org_id = v_org and l.draft_id = d.id;
  if jsonb_array_length(v_lines) = 0 then raise exception 'INVALID_INPUT' using detail = 'the draft has no lines'; end if;

  v_made := public.sal_create_invoice(d.order_id, d.invoice_date, v_lines);
  update public.sal_invoice_drafts set status = 'issued', invoice_id = (v_made ->> 'id')::uuid, issued_by = auth.uid(), issued_at = now() where id = d.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.invoice_draft.issued', 'sales_invoice_draft', d.id::text, format('Draft issued as invoice %s', v_made ->> 'number'));
  return v_made || jsonb_build_object('draftId', d.id);
end $$;

revoke all on function public.sal_save_invoice_draft(uuid, uuid, date, jsonb), public.sal_discard_invoice_draft(uuid), public.sal_issue_invoice_draft(uuid) from public, anon;
grant execute on function public.sal_save_invoice_draft(uuid, uuid, date, jsonb), public.sal_discard_invoice_draft(uuid), public.sal_issue_invoice_draft(uuid) to authenticated;

-- ================================================================ 4. company document settings

create table if not exists public.core_doc_settings (
  org_id           uuid primary key references public.organizations(id),
  logo             text check (logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' and length(logo) <= 410000)),
  letterhead       text check (letterhead is null or (letterhead ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' and length(letterhead) <= 2100000)),
  margin_top_mm    int not null default 40 check (margin_top_mm between 0 and 150),
  margin_bottom_mm int not null default 30 check (margin_bottom_mm between 0 and 150),
  header_text      text check (header_text is null or length(header_text) <= 1000),
  footer_text      text check (footer_text is null or length(footer_text) <= 1000),
  bank_details     text check (bank_details is null or length(bank_details) <= 1000),
  payment_terms    text check (payment_terms is null or length(payment_terms) <= 500),
  language         text not null default 'ar' check (language in ('ar', 'en', 'both')),
  digits           text not null default 'latn' check (digits in ('latn', 'arab')),
  layout           text not null default 'simple' check (layout in ('simple', 'detailed', 'eta')),
  send_mode        text not null default 'device' check (send_mode in ('device', 'queue')),
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists core_doc_settings_updated_at on public.core_doc_settings;
create trigger core_doc_settings_updated_at before update on public.core_doc_settings for each row execute function public.set_updated_at();

alter table public.core_doc_settings enable row level security;
revoke all on public.core_doc_settings from anon, authenticated;
grant select on public.core_doc_settings to authenticated;
drop policy if exists core_doc_settings_member_read on public.core_doc_settings;
create policy core_doc_settings_member_read on public.core_doc_settings for select to authenticated using (public.is_org_member(org_id));

-- Owners and admins. Only the keys given change; a key given as null clears it (texts and images) or is refused (the choices).
-- The audit row names the fields that changed, never the image data.
create or replace function public.core_save_doc_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.require_org_role(array['owner', 'admin']);
  s         public.core_doc_settings%rowtype;
  v_before  public.core_doc_settings%rowtype;
  v_changed text[] := '{}';
  k         text;
  v_text    text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('logo', 'letterhead', 'marginTopMm', 'marginBottomMm', 'headerText', 'footerText', 'bankDetails', 'paymentTerms',
                 'language', 'digits', 'layout', 'sendMode') then
      raise exception 'INVALID_INPUT' using detail = format('unknown setting %s', k);
    end if;
  end loop;

  insert into public.core_doc_settings (org_id) values (v_org) on conflict (org_id) do nothing;
  select * into s from public.core_doc_settings where org_id = v_org for update;
  v_before := s;

  begin
    if p ? 'logo' then s.logo := nullif(p ->> 'logo', ''); end if;
    if p ? 'letterhead' then s.letterhead := nullif(p ->> 'letterhead', ''); end if;
    if p ? 'marginTopMm' then s.margin_top_mm := (p ->> 'marginTopMm')::int; end if;
    if p ? 'marginBottomMm' then s.margin_bottom_mm := (p ->> 'marginBottomMm')::int; end if;
    if p ? 'headerText' then v_text := nullif(trim(coalesce(p ->> 'headerText', '')), ''); s.header_text := v_text; end if;
    if p ? 'footerText' then v_text := nullif(trim(coalesce(p ->> 'footerText', '')), ''); s.footer_text := v_text; end if;
    if p ? 'bankDetails' then v_text := nullif(trim(coalesce(p ->> 'bankDetails', '')), ''); s.bank_details := v_text; end if;
    if p ? 'paymentTerms' then v_text := nullif(trim(coalesce(p ->> 'paymentTerms', '')), ''); s.payment_terms := v_text; end if;
    if p ? 'language' then s.language := p ->> 'language'; end if;
    if p ? 'digits' then s.digits := p ->> 'digits'; end if;
    if p ? 'layout' then s.layout := p ->> 'layout'; end if;
    if p ? 'sendMode' then s.send_mode := p ->> 'sendMode'; end if;
  exception when others then raise exception 'INVALID_INPUT';
  end;

  if s.logo is distinct from v_before.logo then v_changed := array_append(v_changed, 'logo'); end if;
  if s.letterhead is distinct from v_before.letterhead then v_changed := array_append(v_changed, 'letterhead'); end if;
  if s.margin_top_mm is distinct from v_before.margin_top_mm or s.margin_bottom_mm is distinct from v_before.margin_bottom_mm then v_changed := array_append(v_changed, 'margins'); end if;
  if s.header_text is distinct from v_before.header_text then v_changed := array_append(v_changed, 'header'); end if;
  if s.footer_text is distinct from v_before.footer_text then v_changed := array_append(v_changed, 'footer'); end if;
  if s.bank_details is distinct from v_before.bank_details then v_changed := array_append(v_changed, 'bank details'); end if;
  if s.payment_terms is distinct from v_before.payment_terms then v_changed := array_append(v_changed, 'payment terms'); end if;
  if s.language is distinct from v_before.language then v_changed := array_append(v_changed, ('language ' || coalesce(s.language, ''))); end if;
  if s.digits is distinct from v_before.digits then v_changed := array_append(v_changed, ('digits ' || coalesce(s.digits, ''))); end if;
  if s.layout is distinct from v_before.layout then v_changed := array_append(v_changed, ('layout ' || coalesce(s.layout, ''))); end if;
  if s.send_mode is distinct from v_before.send_mode then v_changed := array_append(v_changed, ('send ' || coalesce(s.send_mode, ''))); end if;
  if cardinality(v_changed) = 0 then return jsonb_build_object('changed', '[]'::jsonb); end if;

  begin
    update public.core_doc_settings set logo = s.logo, letterhead = s.letterhead, margin_top_mm = s.margin_top_mm, margin_bottom_mm = s.margin_bottom_mm,
           header_text = s.header_text, footer_text = s.footer_text, bank_details = s.bank_details, payment_terms = s.payment_terms,
           language = s.language, digits = s.digits, layout = s.layout, send_mode = s.send_mode, updated_by = auth.uid()
     where org_id = v_org;
  exception when check_violation or not_null_violation then raise exception 'INVALID_INPUT' using detail = 'a setting is not allowed (size, type or choice)';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.doc_settings.updated', 'doc_settings', v_org::text, 'Document settings changed: ' || array_to_string(v_changed, ', '));
  return jsonb_build_object('changed', to_jsonb(v_changed));
end $$;
revoke all on function public.core_save_doc_settings(jsonb) from public, anon;
grant execute on function public.core_save_doc_settings(jsonb) to authenticated;

-- ================================================================ 7. the print builder (one place, for every way of printing)

-- The VAT rate a draft line would get at issue: the same choice rules as sal_create_invoice (sql/088, sql/093). Never raises: a choice
-- that issue would refuse shows here as no rate (rateId null), and issuing then gives the clear error.
create or replace function public.sal__draft_line_rate(p_org uuid, p_item uuid, p_choice text) returns table (rate_id uuid, rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_vat boolean; v_default uuid; v_id uuid;
begin
  select coalesce((s.settings ->> 'vat_registered')::boolean, false), nullif(s.settings ->> 'default_vat_rate_id', '')::uuid
    into v_vat, v_default from public.organizations s where s.id = p_org;
  if not v_vat or p_choice = 'exempt' then return query select null::uuid, 0::numeric; return; end if;
  if p_choice is not null then
    v_id := p_choice::uuid;
  else
    select t.id into v_id from public.inv_items it join public.tax_rates t on t.org_id = it.org_id and t.id = it.default_tax_rate_id
     where it.org_id = p_org and it.id = p_item and t.tax_type = 'T1' and t.deleted_at is null;
    v_id := coalesce(v_id, v_default);
  end if;
  return query select t.id, t.rate from public.tax_rates t where t.org_id = p_org and t.id = v_id and t.tax_type = 'T1' and t.deleted_at is null;
  if not found then return query select null::uuid, 0::numeric; end if;
end $$;
revoke all on function public.sal__draft_line_rate(uuid, uuid, text) from public, anon, authenticated;

-- p_type: 'draft', 'invoice' or 'note'. Returns null when the document is not in the company. Holds only what a printed invoice shows:
-- never cost, never the audit log, never other customers.
create or replace function public.sal__doc_print_data(p_org uuid, p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_doc      jsonb;
  v_lines    jsonb;
  v_customer uuid;
  v_incl     boolean;
  v_company  jsonb;
  v_settings jsonb;
  v_cust     jsonb;
  v_net      bigint;
  v_tax      bigint;
begin
  if p_type = 'invoice' then
    select jsonb_build_object('type', 'invoice', 'kind', 'invoice', 'id', i.id, 'number', i.number, 'status', i.status, 'date', i.invoice_date,
             'dueDate', i.due_date, 'currency', i.currency, 'netMinor', i.net_minor, 'taxMinor', i.tax_minor, 'grossMinor', i.gross_minor,
             'issuedAt', i.created_at, 'orderNumber', o.number, 'invoiceNumber', null, 'reason', null),
           i.customer_id
      into v_doc, v_customer
      from public.sal_invoices i left join public.sal_orders o on o.org_id = i.org_id and o.id = i.order_id
     where i.org_id = p_org and i.id = p_id;
    if v_doc is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'itemId', it.id, 'sku', it.sku, 'name', it.name, 'uom', it.uom, 'qty', l.qty, 'unit', ol.unit, 'unitFactor', ol.unit_factor,
             'unitPriceMinor', l.unit_price_minor, 'priceIncludesVat', l.price_includes_vat, 'taxRate', l.tax_rate,
             'netMinor', l.net_minor, 'taxMinor', l.tax_minor, 'taxType', t.tax_type, 'taxSubType', t.sub_type,
             'etaItemType', it.eta_item_type, 'etaItemCode', it.eta_item_code, 'etaUnitCode', it.eta_unit_code) order by l.created_at, l.id), '[]'::jsonb)
      into v_lines
      from public.sal_invoice_lines l
      join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
      join public.inv_items it on it.org_id = l.org_id and it.id = ol.item_id
      left join public.tax_rates t on t.org_id = l.org_id and t.id = l.tax_rate_id
     where l.org_id = p_org and l.invoice_id = p_id;

  elsif p_type = 'note' then
    select jsonb_build_object('type', 'note', 'kind', n.kind, 'id', n.id, 'number', n.number, 'status', n.status,
             'date', public.acc__local_date(p_org, coalesce(n.decided_at, n.created_at)), 'dueDate', null, 'currency', n.currency,
             'netMinor', n.net_minor, 'taxMinor', n.tax_minor, 'grossMinor', n.gross_minor, 'issuedAt', coalesce(n.decided_at, n.created_at),
             'orderNumber', null, 'invoiceNumber', i.number, 'invoiceDate', i.invoice_date, 'reason', n.reason),
           n.customer_id
      into v_doc, v_customer
      from public.sal_notes n join public.sal_invoices i on i.org_id = n.org_id and i.id = n.invoice_id
     where n.org_id = p_org and n.id = p_id;
    if v_doc is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'itemId', it.id, 'sku', it.sku, 'name', it.name, 'uom', it.uom, 'qty', nl.qty, 'unit', null, 'unitFactor', null,
             'unitPriceMinor', nl.unit_price_minor, 'priceIncludesVat', nl.price_includes_vat, 'taxRate', nl.tax_rate,
             'netMinor', nl.net_minor, 'taxMinor', nl.tax_minor, 'taxType', t.tax_type, 'taxSubType', t.sub_type,
             'etaItemType', it.eta_item_type, 'etaItemCode', it.eta_item_code, 'etaUnitCode', it.eta_unit_code) order by nl.created_at, nl.id), '[]'::jsonb)
      into v_lines
      from public.sal_note_lines nl
      join public.sal_invoice_lines il on il.org_id = nl.org_id and il.id = nl.invoice_line_id
      join public.sal_order_lines ol on ol.org_id = il.org_id and ol.id = il.order_line_id
      join public.inv_items it on it.org_id = il.org_id and it.id = ol.item_id
      left join public.tax_rates t on t.org_id = nl.org_id and t.id = nl.tax_rate_id
     where nl.org_id = p_org and nl.note_id = p_id;

  elsif p_type = 'draft' then
    select jsonb_build_object('type', 'draft', 'kind', 'invoice', 'id', d.id, 'number', null, 'status', d.status, 'date', d.invoice_date,
             'dueDate', null, 'currency', d.currency, 'issuedAt', null, 'orderNumber', o.number, 'invoiceNumber', null, 'reason', null,
             'invoiceId', d.invoice_id),
           d.customer_id
      into v_doc, v_customer
      from public.sal_invoice_drafts d left join public.sal_orders o on o.org_id = d.org_id and o.id = d.order_id
     where d.org_id = p_org and d.id = p_id and d.deleted_at is null;
    if v_doc is null then return null; end if;
    -- Amounts as issue would make them (sql/093's line maths), from the order line's price and today's VAT choice.
    select coalesce((s.settings ->> 'vat_registered')::boolean, false) and coalesce((s.settings ->> 'prices_include_vat')::boolean, false)
      into v_incl from public.organizations s where s.id = p_org;
    with x as (
      select dl.created_at, dl.id, it.id as item_id, it.sku, it.name, it.uom, dl.qty, ol.unit, ol.unit_factor, ol.unit_price_minor,
             rr.rate_id, coalesce(rr.rate, 0) as rate, it.eta_item_type, it.eta_item_code, it.eta_unit_code
        from public.sal_invoice_draft_lines dl
        join public.sal_order_lines ol on ol.org_id = dl.org_id and ol.id = dl.order_line_id
        join public.inv_items it on it.org_id = dl.org_id and it.id = ol.item_id
        left join lateral public.sal__draft_line_rate(p_org, it.id, dl.tax_choice) rr on true
       where dl.org_id = p_org and dl.draft_id = p_id
    ), y as (
      select x.*,
             case when v_incl then round(round(x.qty * x.unit_price_minor) * 100 / (100 + x.rate))::bigint
                  else round(x.qty * x.unit_price_minor)::bigint end as net_minor,
             round(x.qty * x.unit_price_minor)::bigint as gross_if_incl
        from x
    ), z as (
      select y.*, case when v_incl then y.gross_if_incl - y.net_minor else round(y.net_minor * y.rate / 100)::bigint end as tax_minor from y
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'itemId', z.item_id, 'sku', z.sku, 'name', z.name, 'uom', z.uom, 'qty', z.qty, 'unit', z.unit, 'unitFactor', z.unit_factor,
             'unitPriceMinor', z.unit_price_minor, 'priceIncludesVat', v_incl, 'taxRate', z.rate, 'netMinor', z.net_minor, 'taxMinor', z.tax_minor,
             'taxType', t.tax_type, 'taxSubType', t.sub_type,
             'etaItemType', z.eta_item_type, 'etaItemCode', z.eta_item_code, 'etaUnitCode', z.eta_unit_code) order by z.created_at, z.id), '[]'::jsonb),
           coalesce(sum(z.net_minor), 0), coalesce(sum(z.tax_minor), 0)
      into v_lines, v_net, v_tax
      from z left join public.tax_rates t on t.org_id = p_org and t.id = z.rate_id;
    v_doc := v_doc || jsonb_build_object('netMinor', v_net, 'taxMinor', v_tax, 'grossMinor', v_net + v_tax);
  else
    raise exception 'INVALID_INPUT';
  end if;

  select jsonb_build_object('name', c.name, 'contact', c.contact, 'city', c.city, 'phone', c.phone, 'code', c.code,
           'taxIdType', c.tax_id_type, 'taxId', c.tax_id, 'country', c.country, 'governate', c.governate, 'regionCity', c.region_city,
           'street', c.street, 'buildingNumber', c.building_number)
    into v_cust from public.sal_customers c where c.org_id = p_org and c.id = v_customer;

  select jsonb_build_object('name', g.name, 'legalName', tp.legal_name, 'taxNumber', tp.registration_number, 'activityCode', tp.activity_code,
           'vatRegistered', coalesce((g.settings ->> 'vat_registered')::boolean, false),
           'branch', (select jsonb_build_object('code', b.branch_code, 'name', b.name, 'country', b.country, 'governate', b.governate,
                              'regionCity', b.region_city, 'street', b.street, 'buildingNumber', b.building_number, 'postalCode', b.postal_code)
                        from public.tax_branches b where b.org_id = g.id and b.deleted_at is null order by b.branch_code limit 1))
    into v_company from public.organizations g left join public.tax_profiles tp on tp.org_id = g.id where g.id = p_org;

  select jsonb_build_object('logo', s.logo, 'letterhead', s.letterhead, 'marginTopMm', s.margin_top_mm, 'marginBottomMm', s.margin_bottom_mm,
           'headerText', s.header_text, 'footerText', s.footer_text, 'bankDetails', s.bank_details, 'paymentTerms', s.payment_terms,
           'language', s.language, 'digits', s.digits, 'layout', s.layout)
    into v_settings from public.core_doc_settings s where s.org_id = p_org;

  return jsonb_build_object('document', v_doc, 'lines', v_lines, 'customer', v_cust, 'company', v_company,
           'settings', coalesce(v_settings, jsonb_build_object('logo', null, 'letterhead', null, 'marginTopMm', 40, 'marginBottomMm', 30,
             'headerText', null, 'footerText', null, 'bankDetails', null, 'paymentTerms', null, 'language', 'ar', 'digits', 'latn', 'layout', 'simple')));
end $$;
revoke all on function public.sal__doc_print_data(uuid, text, uuid) from public, anon, authenticated;

-- Signed-in print: any member of the company (viewers too) who can read sales.
create or replace function public.sal_doc_print_data(p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member', 'viewer']);
  v     jsonb;
begin
  if p_type is null or p_type not in ('draft', 'invoice', 'note') or p_id is null then raise exception 'INVALID_INPUT'; end if;
  v := public.sal__doc_print_data(v_org, p_type, p_id);
  if v is null then raise exception 'NOT_FOUND'; end if;
  return v;
end $$;
revoke all on function public.sal_doc_print_data(text, uuid) from public, anon;
grant execute on function public.sal_doc_print_data(text, uuid) to authenticated;

-- ================================================================ 5. invoice links

create table if not exists public.sal_doc_links (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  doc_type     text not null check (doc_type in ('invoice', 'note')),
  doc_id       uuid not null,
  token        text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id),
  last_read_at timestamptz,
  read_count   bigint not null default 0,
  unique (org_id, id)
);
-- At most one working link per document.
create unique index if not exists sal_doc_links_active_uq on public.sal_doc_links (org_id, doc_type, doc_id) where revoked_at is null;

alter table public.sal_doc_links enable row level security;
-- No grants at all: the token is read only through sal_doc_link (below).
revoke all on public.sal_doc_links from anon, authenticated;

-- An issued invoice, or an approved note whose invoice is not void: the only documents a link or a send may point at.
create or replace function public.sal__doc_sendable(p_org uuid, p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_type
    when 'invoice' then exists (select 1 from public.sal_invoices i where i.org_id = p_org and i.id = p_id and i.status = 'issued')
    when 'note' then exists (select 1 from public.sal_notes n join public.sal_invoices i on i.org_id = n.org_id and i.id = n.invoice_id
                              where n.org_id = p_org and n.id = p_id and n.status = 'approved' and i.status = 'issued')
    else false end;
$$;
revoke all on function public.sal__doc_sendable(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.sal__doc_label(p_org uuid, p_type text, p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p_type
    when 'invoice' then (select i.number from public.sal_invoices i where i.org_id = p_org and i.id = p_id)
    when 'note' then (select n.number from public.sal_notes n where n.org_id = p_org and n.id = p_id) end;
$$;
revoke all on function public.sal__doc_label(uuid, text, uuid) from public, anon, authenticated;

-- The link of a document: the working one, or a new one when there is none or p_new is true (the old one then stops working).
-- Owners, admins and members (the people who may send; API key sales.invoices.send).
create or replace function public.sal_doc_link(p_doc_type text, p_doc_id uuid, p_new boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  l     public.sal_doc_links%rowtype;
  v_lbl text;
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'note') or p_doc_id is null then raise exception 'INVALID_INPUT'; end if;
  v_lbl := public.sal__doc_label(v_org, p_doc_type, p_doc_id);
  if v_lbl is null then raise exception 'NOT_FOUND'; end if;
  if not public.sal__doc_sendable(v_org, p_doc_type, p_doc_id) then
    raise exception 'INVALID_STATE' using detail = 'only an issued invoice or an approved note can have a link';
  end if;
  select * into l from public.sal_doc_links where org_id = v_org and doc_type = p_doc_type and doc_id = p_doc_id and revoked_at is null for update;
  if found and not coalesce(p_new, false) then
    return jsonb_build_object('token', l.token, 'createdAt', l.created_at, 'readCount', l.read_count, 'lastReadAt', l.last_read_at);
  end if;
  if found then
    update public.sal_doc_links set revoked_at = now(), revoked_by = auth.uid() where id = l.id;
  end if;
  insert into public.sal_doc_links (org_id, doc_type, doc_id, token, created_by)
  values (v_org, p_doc_type, p_doc_id, encode(gen_random_bytes(32), 'hex'), auth.uid()) returning * into l;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.document_link.created', case p_doc_type when 'invoice' then 'sales_invoice' else 'sales_note' end, p_doc_id::text,
          format('Customer link made for %s%s', v_lbl, case when p_new then ' (the old link stopped working)' else '' end));
  return jsonb_build_object('token', l.token, 'createdAt', l.created_at, 'readCount', l.read_count, 'lastReadAt', l.last_read_at);
end $$;

-- Is there a working link, and how often was it opened? No token here.
create or replace function public.sal_doc_link_status(p_doc_type text, p_doc_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member', 'viewer']);
  l     public.sal_doc_links%rowtype;
begin
  select * into l from public.sal_doc_links where org_id = v_org and doc_type = p_doc_type and doc_id = p_doc_id and revoked_at is null;
  if not found then return jsonb_build_object('active', false); end if;
  return jsonb_build_object('active', public.sal__doc_sendable(v_org, p_doc_type, p_doc_id), 'createdAt', l.created_at,
           'readCount', l.read_count, 'lastReadAt', l.last_read_at);
end $$;

create or replace function public.sal_revoke_doc_link(p_doc_type text, p_doc_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  l     public.sal_doc_links%rowtype;
begin
  select * into l from public.sal_doc_links where org_id = v_org and doc_type = p_doc_type and doc_id = p_doc_id and revoked_at is null for update;
  if not found then return; end if;   -- no working link: nothing changes, no audit row
  update public.sal_doc_links set revoked_at = now(), revoked_by = auth.uid() where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.document_link.revoked', case p_doc_type when 'invoice' then 'sales_invoice' else 'sales_note' end, p_doc_id::text,
          format('Customer link for %s switched off', public.sal__doc_label(v_org, p_doc_type, p_doc_id)));
end $$;

-- The public read (anon). The token is the only credential. Missing, switched off, voided, note no longer approved, sales switched off:
-- all the same NOT_FOUND. Counts each read.
create or replace function public.sal_doc_link_print(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.sal_doc_links%rowtype;
  v jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND'; end if;
  select * into l from public.sal_doc_links where token = p_token and revoked_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.org_modules m where m.org_id = l.org_id and m.module_key = 'sales' and m.disabled_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  if not public.sal__doc_sendable(l.org_id, l.doc_type, l.doc_id) then raise exception 'NOT_FOUND'; end if;
  v := public.sal__doc_print_data(l.org_id, l.doc_type, l.doc_id);
  if v is null then raise exception 'NOT_FOUND'; end if;
  update public.sal_doc_links set last_read_at = now(), read_count = read_count + 1 where id = l.id;
  return v;
end $$;

revoke all on function public.sal_doc_link(text, uuid, boolean), public.sal_doc_link_status(text, uuid), public.sal_revoke_doc_link(text, uuid),
  public.sal_doc_link_print(text) from public, anon, authenticated;
grant execute on function public.sal_doc_link(text, uuid, boolean), public.sal_doc_link_status(text, uuid), public.sal_revoke_doc_link(text, uuid) to authenticated;
grant execute on function public.sal_doc_link_print(text) to anon, authenticated;

-- ================================================================ 6. send records (append-only)

create table if not exists public.core_doc_sends (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  doc_type   text not null check (doc_type in ('invoice', 'note')),
  doc_id     uuid not null,
  channel    text not null check (channel in ('whatsapp', 'email', 'download', 'print', 'link')),
  mode       text not null default 'device' check (mode in ('device', 'queue')),
  recipient  text check (recipient is null or length(recipient) <= 200),
  layout     text check (layout is null or layout in ('simple', 'detailed', 'eta')),
  language   text check (language is null or language in ('ar', 'en', 'both')),
  sent_by    uuid not null references auth.users(id),
  sent_at    timestamptz not null default now()
);
create index if not exists core_doc_sends_doc_idx on public.core_doc_sends (org_id, doc_type, doc_id, sent_at desc);

create or replace function public.core__doc_sends_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'INVALID_STATE' using detail = 'send records are never changed or deleted';
end $$;
revoke all on function public.core__doc_sends_append_only() from public, anon, authenticated;
drop trigger if exists core_doc_sends_append_only on public.core_doc_sends;
create trigger core_doc_sends_append_only before update or delete on public.core_doc_sends
  for each row execute function public.core__doc_sends_append_only();

alter table public.core_doc_sends enable row level security;
revoke all on public.core_doc_sends from anon, authenticated;
grant select on public.core_doc_sends to authenticated;
drop policy if exists core_doc_sends_member_read on public.core_doc_sends;
create policy core_doc_sends_member_read on public.core_doc_sends for select to authenticated using (public.is_org_member(org_id));

-- Record that the person printed, downloaded or sent an issued invoice or approved note. Drafts are not sent.
create or replace function public.sal_record_doc_send(p_doc_type text, p_doc_id uuid, p_channel text, p_mode text, p_recipient text,
                                                      p_layout text, p_language text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  v_lbl text;
  v_id  uuid;
  v_to  text := nullif(trim(coalesce(p_recipient, '')), '');
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'note') or p_doc_id is null then raise exception 'INVALID_INPUT'; end if;
  v_lbl := public.sal__doc_label(v_org, p_doc_type, p_doc_id);
  if v_lbl is null then raise exception 'NOT_FOUND'; end if;
  if not public.sal__doc_sendable(v_org, p_doc_type, p_doc_id) then
    raise exception 'INVALID_STATE' using detail = 'only an issued invoice or an approved note can be sent';
  end if;
  begin
    insert into public.core_doc_sends (org_id, doc_type, doc_id, channel, mode, recipient, layout, language, sent_by)
    values (v_org, p_doc_type, p_doc_id, p_channel, coalesce(p_mode, 'device'), v_to, p_layout, p_language, auth.uid()) returning id into v_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_INPUT';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.document.sent', case p_doc_type when 'invoice' then 'sales_invoice' else 'sales_note' end, p_doc_id::text,
          format('%s: %s%s', v_lbl,
                 case p_channel when 'whatsapp' then 'sent by WhatsApp' when 'email' then 'sent by email' when 'download' then 'PDF downloaded'
                                when 'print' then 'printed' else 'link copied' end,
                 case when v_to is null then '' else ' to ' || v_to end));
  return v_id;
end $$;
revoke all on function public.sal_record_doc_send(text, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.sal_record_doc_send(text, uuid, text, text, text, text, text) to authenticated;

commit;

-- Verification (read-only).
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
          and relname in ('sal_invoice_drafts', 'sal_invoice_draft_lines', 'core_doc_settings', 'sal_doc_links', 'core_doc_sends')) as new_tables_with_rls,   -- 5
       has_table_privilege('authenticated', 'public.sal_doc_links', 'select') as users_read_links_table,                                         -- false
       has_table_privilege('authenticated', 'public.core_doc_sends', 'insert') as users_write_sends,                                             -- false
       has_function_privilege('anon', 'public.sal_doc_link_print(text)', 'execute') as anon_reads_link,                                          -- true
       has_function_privilege('anon', 'public.sal_doc_link(text,uuid,boolean)', 'execute') as anon_makes_link,                                   -- false
       has_function_privilege('authenticated', 'public.sal__doc_print_data(uuid,text,uuid)', 'execute') as users_call_builder,                   -- false
       (select count(*) from pg_trigger where tgname in ('sal_invoices_issued_lock', 'sal_invoice_lines_issued_lock', 'core_doc_sends_append_only')) as locks; -- 3
