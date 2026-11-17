-- 094_pur_supplier_notes.sql
-- Supplier credit and debit notes (documentation/plans/VAT_PLAN.md section 16; Ben, 17 Nov: "go", long term: the data model ready for
-- goods returned to the supplier from the start, the money part switched on first).
--   * pur_notes / pur_note_lines: a note against one recorded supplier bill and only its lines: quantity and unit cost before VAT, the
--     bill line's VAT rate (copied); the supplier's own note number and e-invoice number; VAT as printed on the supplier's note within the
--     same tolerance as bills (the larger of 1 minor unit per line and 5 per note); deductible as the bill was.
--   * pur_note_returns: goods going back to the supplier, per note line (table and rules ready; not written by any function yet: the
--     second step, VAT plan section 16 question 2).
--   * Limits in the database: a credit note never credits more than was billed per line (quantity over open and approved credit notes;
--     unit cost not above the bill's). Requested by one person (owner, admin or member), decided by an owner or admin who is not the
--     requester, except under core__sole_approver (D1/D1b/D1c, sql/063, 077): then flagged self_decided and audited as self-approved.
--   * Nothing counts until approved. Approved: posts (credit: Dr suppliers gross / Cr purchase price differences net and any
--     non-deductible VAT / Cr input VAT the deductible VAT; debit: the reverse), lowers or raises what is owed on the bill, and enters
--     the VAT summary on the approval day (the summary's "excludes supplier credit notes" warning goes).
--   * Owed on a bill = gross - approved credit notes + approved debit notes - payments: fin_record_payment, insights_home recreated from
--     sql/087, fin_vat_summary from sql/089 (each copied with only these changes, checked by script).
-- Depends on sql/001-093. Rerun-safe. Then run sql/tests/089_pur_supplier_notes.sql.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.pur_notes (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  kind             text not null check (kind in ('credit', 'debit')),
  bill_id          uuid not null,
  supplier_id      uuid not null,
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  supplier_ref     text check (supplier_ref is null or length(supplier_ref) between 1 and 100),
  vat_document_ref text check (vat_document_ref is null or length(vat_document_ref) between 1 and 100),
  reason           text not null check (length(trim(reason)) between 1 and 500),
  status           text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'cancelled')),
  net_minor        bigint not null default 0,
  line_tax_minor   bigint not null default 0,
  tax_minor        bigint not null default 0,
  gross_minor      bigint not null default 0,
  vat_deductible   boolean not null default false,
  requester_id     uuid not null references auth.users(id),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_comment text,
  self_decided     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, bill_id) references public.pur_supplier_invoices (org_id, id),
  foreign key (org_id, supplier_id) references public.pur_suppliers (org_id, id),
  constraint pur_notes_totals_chk check (net_minor >= 0 and tax_minor >= 0 and line_tax_minor >= 0 and gross_minor = net_minor + tax_minor),
  constraint pur_notes_decider_chk check (decided_by is null or decided_by <> requester_id or self_decided),
  constraint pur_notes_decided_when_approved check (status <> 'approved' or decided_by is not null)
);
create index if not exists pur_notes_org_bill_idx on public.pur_notes (org_id, bill_id);
create index if not exists pur_notes_org_status_idx on public.pur_notes (org_id, status, created_at desc);

create table if not exists public.pur_note_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  note_id         uuid not null,
  bill_line_id    uuid not null,
  qty             numeric(18, 3) not null check (qty > 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  tax_rate_id     uuid,
  tax_rate        numeric(8, 5) not null default 0 check (tax_rate between 0 and 100),
  net_minor       bigint,
  tax_minor       bigint not null default 0,
  created_at      timestamptz not null default now(),
  unique (note_id, bill_line_id),
  foreign key (org_id, note_id) references public.pur_notes (org_id, id),
  foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id)
);
create index if not exists pur_note_lines_org_note_idx on public.pur_note_lines (org_id, note_id);
create index if not exists pur_note_lines_org_bill_line_idx on public.pur_note_lines (org_id, bill_line_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pur_supplier_invoice_lines_org_id_uq') then
    alter table public.pur_supplier_invoice_lines add constraint pur_supplier_invoice_lines_org_id_uq unique (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pur_note_lines_bill_line_fk') then
    alter table public.pur_note_lines add constraint pur_note_lines_bill_line_fk foreign key (org_id, bill_line_id) references public.pur_supplier_invoice_lines (org_id, id);
  end if;
end $$;

-- Goods going back to the supplier (the second step). Ready, with its rules; no function writes it yet.
create table if not exists public.pur_note_returns (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  note_id      uuid not null,
  bill_line_id uuid not null,
  item_id      uuid not null,
  warehouse_id uuid not null,
  qty          numeric(18, 3) not null check (qty > 0),
  created_at   timestamptz not null default now(),
  foreign key (org_id, note_id) references public.pur_notes (org_id, id),
  foreign key (org_id, bill_line_id) references public.pur_supplier_invoice_lines (org_id, id)
);
create index if not exists pur_note_returns_org_note_idx on public.pur_note_returns (org_id, note_id);

drop trigger if exists pur_notes_updated_at on public.pur_notes;
create trigger pur_notes_updated_at before update on public.pur_notes for each row execute function public.set_updated_at();
-- net and VAT per line: the bills' rule (sql/087), on quantity x unit cost and the copied rate
drop trigger if exists pur_note_lines_tax on public.pur_note_lines;
create trigger pur_note_lines_tax before insert on public.pur_note_lines for each row execute function public.pur__line_tax();

alter table public.pur_notes enable row level security;
alter table public.pur_note_lines enable row level security;
alter table public.pur_note_returns enable row level security;
revoke all on public.pur_notes, public.pur_note_lines, public.pur_note_returns from anon, authenticated;
grant select on public.pur_notes, public.pur_note_lines, public.pur_note_returns to authenticated;
drop policy if exists pur_notes_member_read on public.pur_notes;
create policy pur_notes_member_read on public.pur_notes for select to authenticated using (public.is_org_member(org_id));
drop policy if exists pur_note_lines_member_read on public.pur_note_lines;
create policy pur_note_lines_member_read on public.pur_note_lines for select to authenticated using (public.is_org_member(org_id));
drop policy if exists pur_note_returns_member_read on public.pur_note_returns;
create policy pur_note_returns_member_read on public.pur_note_returns for select to authenticated using (public.is_org_member(org_id));

-- What may change on a note, and in which order: amounts are set once (by pur_submit_note, under erp.doc_totals); status only forward.
create or replace function public.pur__notes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.org_id, new.number, new.kind, new.bill_id, new.supplier_id, new.currency, new.reason, new.requester_id)
     is distinct from (old.org_id, old.number, old.kind, old.bill_id, old.supplier_id, old.currency, old.reason, old.requester_id) then
    raise exception 'INVALID_STATE' using detail = 'a supplier note cannot be edited';
  end if;
  if (new.net_minor, new.line_tax_minor, new.tax_minor, new.gross_minor, new.vat_deductible, new.vat_document_ref, new.supplier_ref)
     is distinct from (old.net_minor, old.line_tax_minor, old.tax_minor, old.gross_minor, old.vat_deductible, old.vat_document_ref, old.supplier_ref)
     and current_setting('erp.doc_totals', true) is distinct from 'on' then
    raise exception 'INVALID_STATE' using detail = 'a supplier note cannot be edited';
  end if;
  if new.status <> old.status and not (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled')) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;
revoke all on function public.pur__notes_guard() from public, anon, authenticated;
drop trigger if exists pur_notes_guard on public.pur_notes;
create trigger pur_notes_guard before update on public.pur_notes for each row execute function public.pur__notes_guard();
drop trigger if exists pur_note_lines_append_only on public.pur_note_lines;
create trigger pur_note_lines_append_only before update or delete on public.pur_note_lines for each statement execute function public.inv_append_only();
drop trigger if exists pur_note_lines_no_truncate on public.pur_note_lines;
create trigger pur_note_lines_no_truncate before truncate on public.pur_note_lines for each statement execute function public.inv_append_only();
drop trigger if exists pur_note_returns_append_only on public.pur_note_returns;
create trigger pur_note_returns_append_only before update or delete on public.pur_note_returns for each statement execute function public.inv_append_only();
drop trigger if exists pur_note_returns_no_truncate on public.pur_note_returns;
create trigger pur_note_returns_no_truncate before truncate on public.pur_note_returns for each statement execute function public.inv_append_only();

-- ---------------------------------------------------------------- request, decide, cancel

-- p_lines: [{ "billLineId", "qty", "unitCostMinor"? (before VAT; default the bill line's) }]. p_vat: { "taxMinor"?: VAT printed on the
-- supplier's note (default: computed), "documentRef"?: its e-invoice number }.
create or replace function public.pur_submit_note(p_bill_id uuid, p_kind text, p_reason text, p_supplier_ref text, p_lines jsonb, p_vat jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.pur__guard(array['owner', 'admin', 'member']); b public.pur_supplier_invoices; bl public.pur_supplier_invoice_lines;
  v_id uuid := gen_random_uuid(); v_no text; v_n bigint; r record; v_cost bigint; v_taken numeric; v_count int := 0; v_tax bigint; n public.pur_notes;
  v_ref text := nullif(trim(coalesce(p_vat ->> 'documentRef', '')), ''); v_sref text := nullif(trim(coalesce(p_supplier_ref, '')), '');
begin
  if p_kind is null or p_kind not in ('credit', 'debit') then raise exception 'INVALID_INPUT' using detail = 'kind must be credit or debit'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 or length(p_reason) > 500 then raise exception 'INVALID_INPUT' using detail = 'a reason of up to 500 characters is required'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT' using detail = 'add at least one line'; end if;
  if (v_ref is not null and length(v_ref) > 100) or (v_sref is not null and length(v_sref) > 100) then raise exception 'INVALID_INPUT' using detail = 'a reference is too long'; end if;
  select * into b from public.pur_supplier_invoices where org_id = v_org and id = p_bill_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.inv_counters (org_id, key, value) values (v_org, case p_kind when 'credit' then 'purchase_credit_note' else 'purchase_debit_note' end, 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  v_no := case p_kind when 'credit' then 'SCN-' else 'SDN-' end || lpad(v_n::text, 4, '0');
  insert into public.pur_notes (id, org_id, number, kind, bill_id, supplier_id, currency, supplier_ref, vat_document_ref, reason, vat_deductible, requester_id)
  values (v_id, v_org, v_no, p_kind, b.id, b.supplier_id, b.currency, v_sref, v_ref, trim(p_reason), b.vat_deductible, auth.uid());
  for r in
    select (x ->> 'billLineId')::uuid as line_id, sum((x ->> 'qty')::numeric) as qty, max((x ->> 'unitCostMinor')::bigint) as cost
      from jsonb_array_elements(p_lines) x group by 1 order by 1
  loop
    if r.line_id is null or r.qty is null or r.qty <= 0 or (r.cost is not null and r.cost < 0) then
      raise exception 'INVALID_INPUT' using detail = 'quantities must be above zero and costs not negative';
    end if;
    select * into bl from public.pur_supplier_invoice_lines l where l.org_id = v_org and l.invoice_id = b.id and l.id = r.line_id;
    if not found then raise exception 'INVALID_INPUT' using detail = 'that line is not on the bill'; end if;
    v_cost := coalesce(r.cost, bl.unit_cost_minor);
    if p_kind = 'credit' then
      if v_cost > bl.unit_cost_minor then raise exception 'NOTE_EXCEEDS_INVOICE' using detail = 'a credit note cannot credit more per unit than was billed'; end if;
      select coalesce(sum(nl.qty), 0) into v_taken from public.pur_note_lines nl join public.pur_notes x on x.org_id = nl.org_id and x.id = nl.note_id
       where nl.org_id = v_org and nl.bill_line_id = bl.id and x.kind = 'credit' and x.status in ('submitted', 'approved') and x.id <> v_id;
      if v_taken + r.qty > bl.qty then
        raise exception 'NOTE_EXCEEDS_INVOICE' using detail = format('%s billed, %s already credited or waiting, %s requested', bl.qty, v_taken, r.qty);
      end if;
    end if;
    insert into public.pur_note_lines (org_id, note_id, bill_line_id, qty, unit_cost_minor, tax_rate_id, tax_rate)
    values (v_org, v_id, bl.id, r.qty, v_cost, bl.tax_rate_id, bl.tax_rate);
    v_count := v_count + 1;
  end loop;
  -- totals from the lines; VAT as printed on the supplier's note within the bills' tolerance
  perform set_config('erp.doc_totals', 'on', true);
  update public.pur_notes x set net_minor = s.net, line_tax_minor = s.tax, gross_minor = s.net + x.tax_minor
    from (select coalesce(sum(net_minor), 0)::bigint as net, coalesce(sum(tax_minor), 0)::bigint as tax from public.pur_note_lines where org_id = v_org and note_id = v_id) s
   where x.id = v_id returning x.* into n;
  begin v_tax := coalesce((p_vat ->> 'taxMinor')::bigint, n.line_tax_minor); exception when others then raise exception 'INVALID_INPUT' using detail = 'taxMinor must be a whole number'; end;
  if v_tax < 0 then raise exception 'INVALID_INPUT' using detail = 'VAT cannot be negative'; end if;
  if abs(v_tax - n.line_tax_minor) > greatest(5, v_count) then
    raise exception 'VAT_MISMATCH' using detail = format('the VAT entered (%s) is too far from the VAT worked out from the lines (%s)', v_tax, n.line_tax_minor);
  end if;
  update public.pur_notes set tax_minor = v_tax, gross_minor = net_minor + v_tax where id = v_id returning * into n;
  perform set_config('erp.doc_totals', '', true);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'purchasing.note.submitted', 'supplier_note', v_id::text,
          format('%s supplier %s note for bill %s: %s minor units (%s before VAT, %s VAT) across %s line(s)', v_no, p_kind, b.number, n.gross_minor, n.net_minor, n.tax_minor, v_count),
          jsonb_build_object('net_minor', n.net_minor, 'tax_minor', n.tax_minor, 'gross_minor', n.gross_minor, 'bill_id', b.id, 'supplier_ref', v_sref));
  return jsonb_build_object('id', v_id, 'number', v_no, 'netMinor', n.net_minor, 'taxMinor', n.tax_minor, 'grossMinor', n.gross_minor);
end $$;

create or replace function public.pur_decide_note(p_note_id uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); n public.pur_notes; v_self boolean := false;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'INVALID_INPUT'; end if;
  if p_comment is not null and length(p_comment) > 500 then raise exception 'INVALID_INPUT'; end if;
  select * into n from public.pur_notes where org_id = v_org and id = p_note_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if n.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = 'only a waiting note can be decided'; end if;
  if n.requester_id = auth.uid() then
    if not public.core__sole_approver(v_org) then raise exception 'SELF_APPROVAL'; end if;
    v_self := true;
  end if;
  update public.pur_notes set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), ''), self_decided = v_self
   where id = n.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, metadata)
  values (v_org, auth.uid(), 'purchasing.note.' || p_decision, 'supplier_note', n.id::text,
          format('%s %s%s', n.number, p_decision, case when v_self then ' (self-approved)' else '' end),
          jsonb_build_object('self_decided', v_self));
end $$;

create or replace function public.pur_cancel_note(p_note_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin', 'member']); n public.pur_notes; v_role text;
begin
  select * into n from public.pur_notes where org_id = v_org and id = p_note_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if n.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = 'only a waiting note can be cancelled'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if n.requester_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  update public.pur_notes set status = 'cancelled' where id = n.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'purchasing.note.cancelled', 'supplier_note', n.id::text, n.number || ' cancelled');
end $$;

revoke all on function public.pur_submit_note(uuid, text, text, text, jsonb, jsonb), public.pur_decide_note(uuid, text, text), public.pur_cancel_note(uuid) from public, anon;
grant execute on function public.pur_submit_note(uuid, text, text, text, jsonb, jsonb), public.pur_decide_note(uuid, text, text), public.pur_cancel_note(uuid) to authenticated;

-- ---------------------------------------------------------------- posting (on approval, for companies with accounting on)

create or replace function public.acc__post_pur_note(p_org uuid, p_id uuid, p_backfill boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare n public.pur_notes; v_input bigint; v_cost bigint; v_party jsonb; v_lines jsonb;
begin
  select * into n from public.pur_notes where org_id = p_org and id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if n.status <> 'approved' or n.gross_minor = 0 then return null; end if;
  v_input := case when n.vat_deductible then n.tax_minor else 0 end;
  v_cost := n.net_minor + n.tax_minor - v_input;     -- the change in what the goods cost (non-deductible VAT included)
  v_party := jsonb_build_object('role', 'payables', 'partyType', 'supplier', 'partyId', n.supplier_id);
  if n.kind = 'credit' then
    v_lines := jsonb_build_array(v_party || jsonb_build_object('debit', n.gross_minor),
      jsonb_build_object('role', 'price_variance', 'credit', v_cost), jsonb_build_object('role', 'input_vat', 'credit', v_input));
  else
    v_lines := jsonb_build_array(jsonb_build_object('role', 'price_variance', 'debit', v_cost), jsonb_build_object('role', 'input_vat', 'debit', v_input),
      v_party || jsonb_build_object('credit', n.gross_minor));
  end if;
  return public.acc__post(p_org, public.acc__local_date(p_org, coalesce(n.decided_at, now())), n.currency, 'supplier_note', n.id::text,
    case when n.kind = 'credit' then 'credited' else 'debited' end, 'Supplier ' || n.kind || ' note ' || n.number, v_lines, p_backfill);
end $$;
revoke all on function public.acc__post_pur_note(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.acc__trg_pur_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and public.acc__enabled(new.org_id) then
    perform public.acc__post_pur_note(new.org_id, new.id);
  end if;
  return null;
end $$;
revoke all on function public.acc__trg_pur_note() from public, anon, authenticated;
drop trigger if exists acc_post_pur_note on public.pur_notes;
create trigger acc_post_pur_note after update of status on public.pur_notes for each row execute function public.acc__trg_pur_note();

-- ---------------------------------------------------------------- what is owed on a bill

create or replace function public.pur__bill_due(p_org uuid, p_bill uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select (coalesce((select b.gross_minor from public.pur_supplier_invoices b where b.org_id = p_org and b.id = p_bill), 0)
        - coalesce((select sum(n.gross_minor) from public.pur_notes n where n.org_id = p_org and n.bill_id = p_bill and n.status = 'approved' and n.kind = 'credit'), 0)
        + coalesce((select sum(n.gross_minor) from public.pur_notes n where n.org_id = p_org and n.bill_id = p_bill and n.status = 'approved' and n.kind = 'debit'), 0))::bigint
$$;
revoke all on function public.pur__bill_due(uuid, uuid) from public, anon, authenticated;

-- The three functions below are their latest versions (fin_record_payment and insights_home from sql/087, fin_vat_summary from
-- sql/089) with only the supplier-note changes (copied and checked by script).

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
      v_total := public.pur__bill_due(v_org, p_supplier_invoice_id);   -- gross net of approved supplier notes (sql/094)
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
    select public.pur__bill_due(i.org_id, i.id) as total,
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

create or replace function public.fin_vat_summary(p_from date, p_to date) returns jsonb
-- volatile (not stable): it gathers the lines in a temporary table
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
  v_cur text; v_reg boolean; v_from date; v_sales jsonb; v_purch jsonb; v_docs jsonb; v_warn jsonb := '[]'::jsonb;
  v_out bigint; v_in bigint; v_taxable bigint; v_exempt bigint; v_other int;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_INPUT' using detail = 'a period with an end on or after its start is required'; end if;
  if p_to - p_from > 400 then raise exception 'INVALID_INPUT' using detail = 'choose a period of at most a year'; end if;
  select o.default_currency, coalesce((o.settings ->> 'vat_registered')::boolean, false), nullif(o.settings ->> 'vat_from', '')::date
    into v_cur, v_reg, v_from from public.organizations o where o.id = v_org;

  -- every line that counts, with its section and the document it belongs to
  create temporary table if not exists pg_temp.vat_rows (doc_type text, doc_id uuid, number text, doc_date date, side text, kind text, rate numeric,
    part text, net bigint, tax bigint, nondeductible bigint) on commit drop;
  truncate pg_temp.vat_rows;

  -- sales: invoices
  insert into pg_temp.vat_rows
  select 'customer_invoice', i.id, i.number, i.invoice_date, 'sales',
         case when l.tax_rate > 0 then 'taxable' when t.sub_type in ('V001', 'V002') then 'zero_rated' else 'exempt' end,
         case when l.tax_rate > 0 then l.tax_rate else 0 end, 'invoices', l.net_minor, l.tax_minor, 0
    from public.sal_invoices i join public.sal_invoice_lines l on l.org_id = i.org_id and l.invoice_id = i.id
    left join public.tax_rates t on t.org_id = l.org_id and t.id = l.tax_rate_id
   where i.org_id = v_org and i.status = 'issued' and i.currency = v_cur and i.invoice_date between p_from and p_to;
  -- sales: approved credit (minus) and debit (plus) notes, by the day they were approved
  insert into pg_temp.vat_rows
  select 'sales_note', n.id, n.number, public.acc__local_date(v_org, n.decided_at), 'sales',
         case when l.tax_rate > 0 then 'taxable' when t.sub_type in ('V001', 'V002') then 'zero_rated' else 'exempt' end,
         case when l.tax_rate > 0 then l.tax_rate else 0 end, 'notes',
         case when n.kind = 'credit' then -l.net_minor else l.net_minor end, case when n.kind = 'credit' then -l.tax_minor else l.tax_minor end, 0
    from public.sal_notes n join public.sal_note_lines l on l.org_id = n.org_id and l.note_id = n.id
    left join public.tax_rates t on t.org_id = l.org_id and t.id = l.tax_rate_id
   where n.org_id = v_org and n.status = 'approved' and n.currency = v_cur and n.decided_at is not null
     and public.acc__local_date(v_org, n.decided_at) between p_from and p_to;
  -- purchases: bill lines with their share of the printed VAT
  insert into pg_temp.vat_rows
  select 'supplier_invoice', x.id, x.number, x.invoice_date, 'purchases', x.vat_class, 0, 'bills', x.net_minor,
         case when x.vat_deductible then x.share else 0 end, case when x.vat_deductible then 0 else x.share end
    from (select y.*, y.s0 + case when y.rn = 1 then y.printed - sum(y.s0) over (partition by y.id) else 0 end as share
            from (select b.id, b.number, b.invoice_date, b.vat_deductible, l.vat_class, l.net_minor, b.tax_minor as printed,
                         row_number() over (partition by b.id order by l.tax_minor desc, l.id) as rn,
                         case when b.line_tax_minor = 0 then 0 else round(b.tax_minor::numeric * l.tax_minor / b.line_tax_minor)::bigint end as s0
                    from public.pur_supplier_invoices b join public.pur_supplier_invoice_lines l on l.org_id = b.org_id and l.invoice_id = b.id
                   where b.org_id = v_org and b.currency = v_cur and b.invoice_date between p_from and p_to) y) x;
  -- purchases: approved supplier credit (minus) and debit (plus) notes, by the day they were approved; printed VAT shared over the lines (sql/094)
  insert into pg_temp.vat_rows
  select 'supplier_note', x.id, x.number, x.d, 'purchases', x.vat_class, 0, 'notes', x.sgn * x.net_minor,
         case when x.vat_deductible then x.sgn * x.share else 0 end, case when x.vat_deductible then 0 else x.sgn * x.share end
    from (select y.*, y.s0 + case when y.rn = 1 then y.printed - sum(y.s0) over (partition by y.id) else 0 end as share
            from (select n.id, n.number, public.acc__local_date(v_org, n.decided_at) as d, n.vat_deductible, bl.vat_class, l.net_minor, n.tax_minor as printed,
                         case when n.kind = 'credit' then -1 else 1 end as sgn,
                         row_number() over (partition by n.id order by l.tax_minor desc, l.id) as rn,
                         case when n.line_tax_minor = 0 then 0 else round(n.tax_minor::numeric * l.tax_minor / n.line_tax_minor)::bigint end as s0
                    from public.pur_notes n join public.pur_note_lines l on l.org_id = n.org_id and l.note_id = n.id
                    join public.pur_supplier_invoice_lines bl on bl.org_id = l.org_id and bl.id = l.bill_line_id
                   where n.org_id = v_org and n.status = 'approved' and n.currency = v_cur and n.decided_at is not null
                     and public.acc__local_date(v_org, n.decided_at) between p_from and p_to) y) x;
  -- purchases: expenses
  insert into pg_temp.vat_rows
  select 'expense', e.id, e.number, e.expense_date, 'purchases', e.vat_class, 0, 'expenses', e.net_minor,
         case when e.vat_deductible then e.tax_minor else 0 end, case when e.vat_deductible then 0 else e.tax_minor end
    from public.fin_expenses e
   where e.org_id = v_org and e.status = 'recorded' and e.currency = v_cur and e.expense_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'rate', s.rate,
           'invoicesNetMinor', s.inet, 'invoicesTaxMinor', s.itax, 'notesNetMinor', s.nnet, 'notesTaxMinor', s.ntax,
           'netMinor', s.inet + s.nnet, 'taxMinor', s.itax + s.ntax)
           order by case s.kind when 'taxable' then 0 when 'zero_rated' then 1 else 2 end, s.rate desc), '[]'::jsonb)
    into v_sales
    from (select kind, rate, coalesce(sum(net) filter (where part = 'invoices'), 0)::bigint as inet, coalesce(sum(tax) filter (where part = 'invoices'), 0)::bigint as itax,
                 coalesce(sum(net) filter (where part = 'notes'), 0)::bigint as nnet, coalesce(sum(tax) filter (where part = 'notes'), 0)::bigint as ntax
            from pg_temp.vat_rows where side = 'sales' group by kind, rate) s;
  select coalesce(jsonb_agg(jsonb_build_object('kind', p.kind, 'netMinor', p.net, 'deductibleTaxMinor', p.tax, 'nonDeductibleTaxMinor', p.nd)
           order by case p.kind when 'local' then 0 when 'capital' then 1 else 2 end), '[]'::jsonb)
    into v_purch
    from (select kind, sum(net)::bigint as net, sum(tax)::bigint as tax, sum(nondeductible)::bigint as nd from pg_temp.vat_rows where side = 'purchases' group by kind) p;
  select coalesce(sum(tax) filter (where side = 'sales'), 0), coalesce(sum(tax) filter (where side = 'purchases'), 0),
         coalesce(sum(net) filter (where side = 'sales' and kind = 'taxable'), 0), coalesce(sum(net) filter (where side = 'sales' and kind = 'exempt'), 0)
    into v_out, v_in, v_taxable, v_exempt from pg_temp.vat_rows;
  select coalesce(jsonb_agg(d order by d ->> 'date', d ->> 'number'), '[]'::jsonb) into v_docs from (
    select jsonb_build_object('type', doc_type, 'id', doc_id, 'number', number, 'date', doc_date, 'side', side, 'kind', kind, 'rate', rate,
             'netMinor', sum(net), 'taxMinor', sum(tax), 'nonDeductibleTaxMinor', sum(nondeductible)) as d
      from pg_temp.vat_rows group by doc_type, doc_id, number, doc_date, side, kind, rate limit 5000) z;

  select (select count(*) from public.sal_invoices where org_id = v_org and status = 'issued' and currency <> v_cur and invoice_date between p_from and p_to)
       + (select count(*) from public.pur_supplier_invoices where org_id = v_org and currency <> v_cur and invoice_date between p_from and p_to)
       + (select count(*) from public.fin_expenses where org_id = v_org and status = 'recorded' and currency <> v_cur and expense_date between p_from and p_to)
    into v_other;
  if not v_reg then v_warn := v_warn || '"not_registered"'::jsonb; end if;
  if v_from is null or p_from < v_from then v_warn := v_warn || '"before_vat_from"'::jsonb; end if;
  if v_taxable > 0 and v_exempt > 0 then v_warn := v_warn || '"partial_deduction"'::jsonb; end if;
  if v_other > 0 then v_warn := v_warn || '"other_currency"'::jsonb; end if;

  return jsonb_build_object('from', p_from, 'to', p_to, 'currency', v_cur, 'vatRegistered', v_reg, 'vatFrom', v_from,
    'sales', v_sales, 'purchases', v_purch,
    'outputTaxMinor', v_out, 'inputTaxMinor', v_in, 'dueMinor', v_out - v_in,
    'warnings', v_warn, 'otherCurrencyDocuments', v_other, 'documents', v_docs);
end $$;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: 3 tables with RLS; users can submit (true), anonymous cannot (false).
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('pur_notes', 'pur_note_lines', 'pur_note_returns') and relrowsecurity) as tables_with_rls,
       has_function_privilege('authenticated', 'public.pur_submit_note(uuid, text, text, text, jsonb, jsonb)', 'execute') as users_submit,
       has_function_privilege('anon', 'public.pur_submit_note(uuid, text, text, text, jsonb, jsonb)', 'execute') as anon_submit;
