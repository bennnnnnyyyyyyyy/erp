-- 037_credit_debit_notes.sql
-- Slice A2 of the Egypt e-invoicing module (documentation/plans/ETA_EINVOICING_PLAN.md sections 5 and 9): credit and debit notes in
-- OUR system first, with approval. A credit note reduces what was invoiced, a debit note adds to it. They are separate documents that
-- refer to an issued customer invoice (an invoice itself is never edited, only voided, sql/022).
-- Rules enforced here, not in the app (same idea as stock transfers, sql/033):
--   * a note refers to an issued (not void) invoice and uses only that invoice's lines (no new items; ETA: only quantities and
--     amounts may change);
--   * a credit note can never credit more than was invoiced: per line, quantity <= invoiced quantity minus what other open or
--     approved credit notes already take, and unit price <= the invoice price;
--   * a note is requested by one person and approved by a different owner or admin, in the data (check constraint + function);
--   * a decision is recorded with its channel (app, whatsapp, voice, api) in an append-only table, and audited;
--   * an invoice with open or approved notes cannot be voided (ETA: ActiveReferencingDocuments, cancel the note first).
-- NOT in this migration (stated plainly): approved notes do not yet reduce the "owed" or revenue figures in finance and owner insights
-- (sql/024, 027, 028, 030), and there is no amount-based approval policy for notes yet (the policy table is quantity-based, sql/011);
-- one approval from an owner or admin who is not the requester is required.
-- Depends on sql/001-036. Rerun-safe. Run the whole file, then sql/tests/031_credit_debit_notes.sql.

begin;

-- Needed as a foreign key target for note lines.
create unique index if not exists sal_invoice_lines_org_id_uq on public.sal_invoice_lines (org_id, id);

create table if not exists public.sal_notes (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  kind             text not null check (kind in ('credit', 'debit')),
  invoice_id       uuid not null,
  customer_id      uuid not null,
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason           text not null check (length(trim(reason)) between 1 and 500),
  status           text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'cancelled')),
  total_minor      bigint not null check (total_minor >= 0),
  requester_id     uuid not null references auth.users(id),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, invoice_id) references public.sal_invoices (org_id, id),
  foreign key (org_id, customer_id) references public.sal_customers (org_id, id),
  -- The approval control, in the data: nobody decides their own note, and an approved note has a decider.
  constraint sal_notes_decider_not_requester check (decided_by is null or decided_by <> requester_id),
  constraint sal_notes_decided_when_approved check (status <> 'approved' or decided_by is not null)
);
create index if not exists sal_notes_org_invoice_idx on public.sal_notes (org_id, invoice_id);
create index if not exists sal_notes_org_status_idx on public.sal_notes (org_id, status, created_at desc);

create table if not exists public.sal_note_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  note_id          uuid not null,
  invoice_line_id  uuid not null,
  qty              numeric(18, 3) not null check (qty > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  created_at       timestamptz not null default now(),
  unique (note_id, invoice_line_id),
  foreign key (org_id, note_id) references public.sal_notes (org_id, id),
  foreign key (org_id, invoice_line_id) references public.sal_invoice_lines (org_id, id)
);
create index if not exists sal_note_lines_org_note_idx on public.sal_note_lines (org_id, note_id);
create index if not exists sal_note_lines_org_invline_idx on public.sal_note_lines (org_id, invoice_line_id);

-- Evidence of each decision and the channel it came through (same shape as inv_approvals and inv_transfer_approvals).
create table if not exists public.sal_note_approvals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  note_id     uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  approver_id uuid not null references auth.users(id),
  comment     text,
  channel     text not null default 'app' check (channel in ('app', 'whatsapp', 'voice', 'api')),
  decided_at  timestamptz not null default now(),
  foreign key (org_id, note_id) references public.sal_notes (org_id, id)
);
create index if not exists sal_note_approvals_org_note_idx on public.sal_note_approvals (org_id, note_id);

drop trigger if exists sal_notes_updated_at on public.sal_notes;
create trigger sal_notes_updated_at before update on public.sal_notes for each row execute function public.set_updated_at();

alter table public.sal_notes enable row level security;
alter table public.sal_note_lines enable row level security;
alter table public.sal_note_approvals enable row level security;
revoke all on public.sal_notes, public.sal_note_lines, public.sal_note_approvals from anon, authenticated;
grant select on public.sal_notes, public.sal_note_lines, public.sal_note_approvals to authenticated;
drop policy if exists sal_notes_member_read on public.sal_notes;
create policy sal_notes_member_read on public.sal_notes for select to authenticated using (public.is_org_member(org_id));
drop policy if exists sal_note_lines_member_read on public.sal_note_lines;
create policy sal_note_lines_member_read on public.sal_note_lines for select to authenticated using (public.is_org_member(org_id));
drop policy if exists sal_note_approvals_member_read on public.sal_note_approvals;
create policy sal_note_approvals_member_read on public.sal_note_approvals for select to authenticated using (public.is_org_member(org_id));

-- What may change on a note, and in which order the statuses may go. Lines are immutable once written.
create or replace function public.sal_notes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.requester_id <> old.requester_id or new.number <> old.number or new.kind <> old.kind
     or new.invoice_id <> old.invoice_id or new.customer_id <> old.customer_id or new.reason <> old.reason
     or new.total_minor <> old.total_minor or new.currency <> old.currency then
    raise exception 'INVALID_STATE' using detail = 'a note cannot be edited';
  end if;
  if new.status <> old.status and not (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled')) then
    raise exception 'INVALID_STATE' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;
drop trigger if exists sal_notes_guard on public.sal_notes;
create trigger sal_notes_guard before update on public.sal_notes for each row execute function public.sal_notes_guard();

drop trigger if exists sal_note_lines_append_only on public.sal_note_lines;
create trigger sal_note_lines_append_only before update or delete on public.sal_note_lines for each statement execute function public.inv_append_only();
drop trigger if exists sal_note_lines_no_truncate on public.sal_note_lines;
create trigger sal_note_lines_no_truncate before truncate on public.sal_note_lines for each statement execute function public.inv_append_only();
drop trigger if exists sal_note_approvals_append_only on public.sal_note_approvals;
create trigger sal_note_approvals_append_only before update or delete on public.sal_note_approvals for each statement execute function public.inv_append_only();
drop trigger if exists sal_note_approvals_no_truncate on public.sal_note_approvals;
create trigger sal_note_approvals_no_truncate before truncate on public.sal_note_approvals for each statement execute function public.inv_append_only();

-- Request a credit or debit note. p_lines: [{ "invoiceLineId": uuid, "qty": number, "unitPriceMinor": number (optional) }].
-- The price defaults to the invoice line's price. Owner, admin or member may request; a different owner or admin approves.
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
  v_total   bigint := 0;
begin
  if p_kind is null or p_kind not in ('credit', 'debit') then raise exception 'INVALID_INPUT' using detail = 'kind must be credit or debit'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 or length(p_reason) > 500 then raise exception 'INVALID_INPUT' using detail = 'a reason of up to 500 characters is required'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID_INPUT' using detail = 'add at least one line'; end if;

  -- Lock the invoice so two notes against it are checked one after the other.
  select * into inv from public.sal_invoices i where i.org_id = v_org and i.id = p_invoice_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if inv.status <> 'issued' then raise exception 'INVALID_STATE' using detail = 'the invoice is void'; end if;

  -- First pass: check every line against the invoice and add up the total. The same invoice line twice is summed.
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
    v_valid := v_valid || jsonb_build_array(jsonb_build_object('line', il.id, 'qty', r.qty, 'price', v_price));
    v_total := v_total + round(r.qty * v_price)::bigint;
  end loop;

  insert into public.inv_counters (org_id, key, value) values (v_org, case p_kind when 'credit' then 'sales_credit_note' else 'sales_debit_note' end, 1)
  on conflict (org_id, key) do update set value = public.inv_counters.value + 1 returning value into v_n;
  v_number := case p_kind when 'credit' then 'CN-' else 'DN-' end || lpad(v_n::text, 4, '0');

  insert into public.sal_notes (id, org_id, number, kind, invoice_id, customer_id, currency, reason, total_minor, requester_id)
  values (v_id, v_org, v_number, p_kind, inv.id, inv.customer_id, inv.currency, trim(p_reason), v_total, auth.uid());
  for e in select x from jsonb_array_elements(v_valid) x loop
    insert into public.sal_note_lines (org_id, note_id, invoice_line_id, qty, unit_price_minor)
    values (v_org, v_id, (e ->> 'line')::uuid, (e ->> 'qty')::numeric, (e ->> 'price')::bigint);
  end loop;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.note.submitted', 'sales_note', v_id::text,
          format('%s %s note for invoice %s: %s minor units across %s line(s)', v_number, p_kind, inv.number, v_total, jsonb_array_length(v_valid)));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;
-- Approve or reject. Owner or admin only, never the requester. The channel records where the decision came from; only the messaging
-- webhook may record a channel other than 'app'.
create or replace function public.sal_decide_note(p_note_id uuid, p_decision text, p_comment text default null, p_channel text default 'app') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin']);
  n     public.sal_notes;
  v_inv text;
begin
  if p_decision not in ('approved', 'rejected') or p_channel not in ('app', 'whatsapp', 'voice', 'api') then raise exception 'INVALID_INPUT'; end if;
  if p_channel <> 'app' and current_setting('erp.trusted_channel', true) is distinct from p_channel then
    raise exception 'INVALID_INPUT' using detail = 'only the messaging webhook can record another channel';
  end if;
  select * into n from public.sal_notes x where x.org_id = v_org and x.id = p_note_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if n.requester_id = auth.uid() then raise exception 'SELF_APPROVAL'; end if;
  if n.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('note is %s', n.status); end if;
  select i.number into v_inv from public.sal_invoices i where i.org_id = v_org and i.id = n.invoice_id and i.status = 'issued';
  if p_decision = 'approved' and v_inv is null then raise exception 'INVALID_STATE' using detail = 'the invoice was voided'; end if;

  insert into public.sal_note_approvals (org_id, note_id, decision, approver_id, comment, channel)
  values (v_org, n.id, p_decision, auth.uid(), nullif(trim(p_comment), ''), p_channel);
  update public.sal_notes x set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment), '') where x.id = n.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, channel)
  values (v_org, auth.uid(), case p_decision when 'approved' then 'sales.note.approved' else 'sales.note.rejected' end, 'sales_note', n.id::text,
          format('%s %s', n.number, p_decision), p_channel);
end $$;

-- Cancel a note that is still waiting: the person who requested it, or an owner or admin.
create or replace function public.sal_cancel_note(p_note_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.sal__guard(array['owner', 'admin', 'member']);
  n      public.sal_notes;
  v_role text;
begin
  select * into n from public.sal_notes x where x.org_id = v_org and x.id = p_note_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.role into v_role from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if n.requester_id <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if n.status <> 'submitted' then raise exception 'INVALID_STATE' using detail = format('note is %s', n.status); end if;
  update public.sal_notes x set status = 'cancelled' where x.id = n.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.note.cancelled', 'sales_note', n.id::text, format('%s cancelled', n.number));
end $$;

-- An invoice that credit or debit notes still refer to cannot be voided: cancel or reject the notes first (ETA: ActiveReferencingDocuments).
-- Same function as sql/022 plus that one check.
create or replace function public.sal_void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin']);
  i     public.sal_invoices%rowtype;
begin
  select * into i from public.sal_invoices where org_id = v_org and id = p_invoice_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.status = 'void' then raise exception 'INVALID_STATE'; end if;
  if exists (select 1 from public.sal_notes n where n.org_id = v_org and n.invoice_id = i.id and n.status in ('submitted', 'approved')) then
    raise exception 'ACTIVE_NOTES' using detail = 'credit or debit notes still refer to this invoice';
  end if;
  update public.sal_invoices set status = 'void', voided_at = now(), voided_by = auth.uid() where id = i.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.invoice.voided', 'sales_invoice', i.id::text, format('%s voided', i.number));
end $$;

revoke all on function public.sal_submit_note(uuid, text, text, jsonb), public.sal_decide_note(uuid, text, text, text), public.sal_cancel_note(uuid) from public, anon;
grant execute on function public.sal_submit_note(uuid, text, text, jsonb), public.sal_decide_note(uuid, text, text, text), public.sal_cancel_note(uuid) to authenticated;
revoke all on function public.sal_void_invoice(uuid) from public, anon;
grant execute on function public.sal_void_invoice(uuid) to authenticated;

commit;

-- Verification (read-only): three tables with RLS, note functions callable by users (true x3).
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('sal_notes', 'sal_note_lines', 'sal_note_approvals') and relrowsecurity) as note_tables_with_rls,
       has_function_privilege('authenticated', 'public.sal_submit_note(uuid,text,text,jsonb)', 'execute') as submit,
       has_function_privilege('authenticated', 'public.sal_decide_note(uuid,text,text,text)', 'execute') as decide,
       has_function_privilege('authenticated', 'public.sal_cancel_note(uuid)', 'execute') as cancel;
