-- sql/068_trs_bank_statements_2.sql
-- Bank statement import and reconciliation, part 2 (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md; Ben's Q5). Rerun-safe.
-- Needs sql/001-067.
--
--   * "Explain" a bank line that matches nothing in the books: record what it was through the existing functions (an expense paid from
--     the bank, a customer payment against an invoice, a supplier payment against a bill, or a transfer between the company's own
--     accounts), then match the new ledger line, all in one transaction. The existing functions keep all their checks (roles, lock date,
--     amounts, treasury account); nothing is posted any other way.
--   * Bank charges (Q5, standard accounting): a "Bank charges" ledger account under Expenses (33) and a "Bank charges" expense category
--     pointed at it, created the first time they are needed (or by trs_prepare_bank_charges). An expense explained without a category
--     goes there.
--   * Rules: "the bank text contains X -> record as an expense in category Y", offered as a suggestion; a person still confirms.
--   * trs_reconcile_roles(): read who may reconcile (the setting of sql/067), for the settings screen.

begin;

create table if not exists public.trs_match_rules (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  account_id   uuid,
  contains     text not null check (length(trim(contains)) between 2 and 80),
  category_id  uuid not null,
  note         text check (note is null or length(note) <= 200),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, id),
  foreign key (org_id, account_id) references public.trs_accounts(org_id, id),
  foreign key (org_id, category_id) references public.fin_categories(org_id, id)
);
alter table public.trs_match_rules enable row level security;
revoke all on public.trs_match_rules from anon, authenticated;
grant select on public.trs_match_rules to authenticated;
drop policy if exists trs_match_rules_read on public.trs_match_rules;
create policy trs_match_rules_read on public.trs_match_rules for select to authenticated using (public.acc__can_read(org_id));

-- ---------------------------------------------------------------- bank charges (Q5)

-- The "Bank charges" category of the company, pointed at a "Bank charges" ledger account under 33 (created when missing). Internal.
create or replace function public.trs__bank_charges_category(p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cat uuid; v_acct uuid; v_parent uuid; v_code text;
begin
  select id into v_cat from public.fin_categories where org_id = p_org and lower(name) = 'bank charges';
  select id into v_acct from public.acc_accounts where org_id = p_org and deleted_at is null and lower(name) = 'bank charges' and kind = 'expense';
  if v_acct is null then
    select id into v_parent from public.acc_accounts where org_id = p_org and code = '33' and deleted_at is null;
    if v_parent is not null then
      select c into v_code from unnest(array['335', '336', '337', '338', '339']) c
       where not exists (select 1 from public.acc_accounts a where a.org_id = p_org and a.code = c) limit 1;
      if v_code is not null then
        insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
        values (p_org, v_code, 'Bank charges', 'مصروفات وعمولات بنكية', v_parent, 'expense', auth.uid()) returning id into v_acct;
        insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
        values (p_org, auth.uid(), 'accounting.account_created', 'account', v_acct::text, format('%s Bank charges added for bank statements', v_code));
      end if;
    end if;
  end if;
  if v_cat is null then
    insert into public.fin_categories (org_id, name, account_id) values (p_org, 'Bank charges', v_acct) returning id into v_cat;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (p_org, auth.uid(), 'finance.category_created', 'expense_category', v_cat::text, 'Bank charges category added for bank statements');
  elsif v_acct is not null then
    update public.fin_categories set account_id = v_acct where id = v_cat and account_id is null;
  end if;
  return v_cat;
end $$;
revoke all on function public.trs__bank_charges_category(uuid) from public, anon, authenticated;

create or replace function public.trs_prepare_bank_charges() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__reconcile_guard();
begin
  return public.trs__bank_charges_category(v_org);
end $$;

-- ---------------------------------------------------------------- who may reconcile (read)

create or replace function public.trs_reconcile_roles() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.trs__guard('read'); v jsonb;
begin
  select coalesce(o.settings -> 'bank_reconcile_roles', '["owner", "head_accountant"]'::jsonb) into v from public.organizations o where o.id = v_org;
  return array(select jsonb_array_elements_text(v) order by 1);
end $$;

-- ---------------------------------------------------------------- rules

create or replace function public.trs_save_rule(p_id uuid, p_account_id uuid, p_contains text, p_category_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__reconcile_guard(); v_id uuid;
begin
  if length(trim(coalesce(p_contains, ''))) < 2 then raise exception 'INVALID_INPUT' using detail = 'at least two letters to look for'; end if;
  if not exists (select 1 from public.fin_categories where org_id = v_org and id = p_category_id) then raise exception 'INVALID_INPUT' using detail = 'choose an expense category'; end if;
  if p_account_id is not null then perform public.trs__bank_account(v_org, p_account_id); end if;
  if p_id is null then
    insert into public.trs_match_rules (org_id, account_id, contains, category_id, note, created_by)
    values (v_org, p_account_id, left(trim(p_contains), 80), p_category_id, nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid()) returning id into v_id;
  else
    update public.trs_match_rules set account_id = p_account_id, contains = left(trim(p_contains), 80), category_id = p_category_id,
           note = nullif(left(trim(coalesce(p_note, '')), 200), '')
     where org_id = v_org and id = p_id and deleted_at is null returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.match_rule_saved', 'match_rule', v_id::text, format('Rule: text contains "%s"', left(trim(p_contains), 80)));
  return v_id;
end $$;

create or replace function public.trs_delete_rule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__reconcile_guard(); r public.trs_match_rules;
begin
  update public.trs_match_rules set deleted_at = now() where org_id = v_org and id = p_id and deleted_at is null returning * into r;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.match_rule_deleted', 'match_rule', r.id::text, format('Rule removed: text contains "%s"', r.contains));
end $$;

-- ---------------------------------------------------------------- explain a line

-- p_kind and p_args:
--   'expense'           money out; {categoryId?, supplierId?, note?}; no category = Bank charges
--   'customer_payment'  money in;  {invoiceId, note?}
--   'supplier_payment'  money out; {billId, note?}
--   'transfer'          either;    {otherAccountId, note?}: money in = from the other account; money out = to it
-- The record is dated on the bank line's date, for its amount, through the bank account. Returns {kind, id, number}.
create or replace function public.trs_explain_line(p_line_id uuid, p_kind text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.trs__reconcile_guard(); l public.trs_statement_lines; a public.trs_accounts; v_amt bigint; v_note text;
  r jsonb; v_source_type text; v_source uuid; v_expense uuid; v_cat uuid; v_entry_line bigint; v_other uuid;
begin
  l := public.trs__open_period_line(v_org, p_line_id);
  if l.status <> 'open' then raise exception 'INVALID_STATE' using detail = format('the line is %s', l.status); end if;
  select * into a from public.trs_accounts where org_id = v_org and id = l.account_id;
  v_amt := abs(l.amount_minor);
  v_note := coalesce(nullif(trim(p_args ->> 'note'), ''), left(nullif(trim(l.description), ''), 200), 'Bank statement line');
  p_args := coalesce(p_args, '{}'::jsonb);

  if p_kind = 'expense' then
    if l.amount_minor > 0 then raise exception 'INVALID_INPUT' using detail = 'an expense is money out; this line is money in'; end if;
    v_cat := coalesce(nullif(p_args ->> 'categoryId', '')::uuid, public.trs__bank_charges_category(v_org));
    r := public.fin_record_expense(l.booking_date, v_cat, v_amt, nullif(p_args ->> 'supplierId', '')::uuid, v_note);
    v_expense := (r ->> 'id')::uuid;
    r := public.fin_record_payment('out', v_amt, l.booking_date, 'bank', null, null, v_expense, v_note, a.id);
    v_source_type := 'payment'; v_source := (r ->> 'id')::uuid;
  elsif p_kind = 'customer_payment' then
    if l.amount_minor < 0 then raise exception 'INVALID_INPUT' using detail = 'a customer payment is money in'; end if;
    r := public.fin_record_payment('in', v_amt, l.booking_date, 'bank', (p_args ->> 'invoiceId')::uuid, null, null, v_note, a.id);
    v_source_type := 'payment'; v_source := (r ->> 'id')::uuid;
  elsif p_kind = 'supplier_payment' then
    if l.amount_minor > 0 then raise exception 'INVALID_INPUT' using detail = 'a supplier payment is money out'; end if;
    r := public.fin_record_payment('out', v_amt, l.booking_date, 'bank', null, (p_args ->> 'billId')::uuid, null, v_note, a.id);
    v_source_type := 'payment'; v_source := (r ->> 'id')::uuid;
  elsif p_kind = 'transfer' then
    v_other := (p_args ->> 'otherAccountId')::uuid;
    if v_other is null or v_other = a.id then raise exception 'INVALID_INPUT' using detail = 'choose the other account'; end if;
    if l.amount_minor > 0 then r := public.trs_record_transfer(v_other, a.id, v_amt, l.booking_date, v_note);
    else r := public.trs_record_transfer(a.id, v_other, v_amt, l.booking_date, v_note); end if;
    v_source_type := 'treasury_transfer'; v_source := (r ->> 'id')::uuid;
  else
    raise exception 'INVALID_INPUT' using detail = 'kind: expense, customer_payment, supplier_payment or transfer';
  end if;

  -- The new record's line on this bank account's ledger account, which is then matched.
  select el.id into v_entry_line
    from public.acc_entries e join public.acc_entry_lines el on el.org_id = e.org_id and el.entry_id = e.id
   where e.org_id = v_org and e.source_type = v_source_type and e.source_id = v_source::text and el.account_id = a.ledger_account_id
     and el.debit_minor - el.credit_minor = l.amount_minor
   order by el.id desc limit 1;
  if v_entry_line is null then
    raise exception 'INVALID_STATE' using detail = 'the record was saved but did not post to this bank account (is accounting on?)';
  end if;
  insert into public.trs_statement_matches (org_id, line_id, entry_line_id, amount_minor, matched_by) values (v_org, l.id, v_entry_line, l.amount_minor, auth.uid());
  update public.trs_statement_lines set status = 'matched', decided_by = auth.uid(), decided_at = now() where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.statement_line_explained', 'statement_line', l.id::text,
          format('%s %s on %s recorded as %s %s and matched', a.code, l.amount_minor, l.booking_date, p_kind, coalesce(r ->> 'number', '')));
  return jsonb_build_object('kind', p_kind, 'id', v_source, 'number', r ->> 'number');
end $$;

revoke all on function public.trs_prepare_bank_charges(), public.trs_reconcile_roles(), public.trs_save_rule(uuid, uuid, text, uuid, text),
  public.trs_delete_rule(uuid), public.trs_explain_line(uuid, text, jsonb) from public, anon;
grant execute on function public.trs_prepare_bank_charges(), public.trs_reconcile_roles(), public.trs_save_rule(uuid, uuid, text, uuid, text),
  public.trs_delete_rule(uuid), public.trs_explain_line(uuid, text, jsonb) to authenticated;

commit;

-- Verification (read-only).
select relrowsecurity as rules_rls from pg_class where relnamespace = 'public'::regnamespace and relname = 'trs_match_rules';
select has_function_privilege('anon', 'public.trs_explain_line(uuid, text, jsonb)', 'execute') as anon_explains,
       has_function_privilege('authenticated', 'public.trs__bank_charges_category(uuid)', 'execute') as users_call_internal;
