-- 048_accounting_manual_journals.sql
-- Accounting phase 1, slice 4 (documentation/plans/ACCOUNTING_PLAN.md scope F and G; ADR-0004 draft §7; Ben's Q5 and O5).
--   * acc_manual_journals + acc_manual_journal_lines: manual journal entries and opening balances. A draft is posted only when someone
--     other than its author approves it (owner or admin; checked in the function AND in a check constraint), except that the owner and a
--     head accountant may post directly (Ben, 5 Nov). Posting writes a normal append-only entry (source 'manual_journal').
--   * kinds: 'manual', and 'opening' (opening balances, dated the first day of a fiscal year).
--   * acc_reverse_journal: a posted manual journal is corrected only by a reversing entry (owner or head accountant).
--   * Audit fix found while reviewing 045-047: an account used by an expense category or an internal-use reason could be made inactive or
--     given sub-accounts, which would make every later expense or issue using it fail to post. acc_update_account and
--     acc_create_account now refuse that, as they already did for posting roles.
-- Accounting must be on for the company (manual journals need the ledger). Depends on sql/001-047. Rerun-safe. Run the whole file,
-- then sql/tests/043_accounting_manual_journals.sql.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.acc_manual_journals (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  number           text not null,
  kind             text not null default 'manual' check (kind in ('manual', 'opening')),
  entry_date       date not null,
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  memo             text not null check (length(trim(memo)) between 1 and 500),
  status           text not null default 'draft' check (status in ('draft', 'posted', 'rejected', 'cancelled')),
  direct           boolean not null default false,
  created_by       uuid not null references auth.users(id),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 500),
  entry_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, entry_id) references public.acc_entries (org_id, id),
  -- The approval control, in the data: nobody decides their own journal; an approved journal has a decider; a direct post has none.
  constraint acc_manual_journals_decider_not_author check (decided_by is null or decided_by <> created_by),
  constraint acc_manual_journals_posted_has_decider check (status <> 'posted' or direct or decided_by is not null),
  constraint acc_manual_journals_direct_no_decider check (not direct or (decided_by is null and status = 'posted')),
  constraint acc_manual_journals_posted_has_entry check ((status = 'posted') = (entry_id is not null))
);
create index if not exists acc_manual_journals_status_idx on public.acc_manual_journals (org_id, status);

create table if not exists public.acc_manual_journal_lines (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id),
  journal_id    uuid not null,
  line_no       int not null check (line_no > 0),
  account_id    uuid not null,
  debit_minor   bigint not null default 0 check (debit_minor >= 0),
  credit_minor  bigint not null default 0 check (credit_minor >= 0),
  party_type    text check (party_type in ('customer', 'supplier')),
  party_id      uuid,
  memo          text check (memo is null or length(memo) <= 500),
  check ((debit_minor > 0) <> (credit_minor > 0)),
  check ((party_type is null) = (party_id is null)),
  unique (org_id, journal_id, line_no),
  foreign key (org_id, journal_id) references public.acc_manual_journals (org_id, id),
  foreign key (org_id, account_id) references public.acc_accounts (org_id, id)
);

alter table public.acc_manual_journals enable row level security;
alter table public.acc_manual_journal_lines enable row level security;
revoke all on public.acc_manual_journals, public.acc_manual_journal_lines from anon, authenticated;
grant select on public.acc_manual_journals, public.acc_manual_journal_lines to authenticated;
drop policy if exists acc_manual_journals_read on public.acc_manual_journals;
create policy acc_manual_journals_read on public.acc_manual_journals for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists acc_manual_journal_lines_read on public.acc_manual_journal_lines;
create policy acc_manual_journal_lines_read on public.acc_manual_journal_lines for select to authenticated using (public.acc__can_read(org_id));
drop trigger if exists acc_manual_journals_updated_at on public.acc_manual_journals;
create trigger acc_manual_journals_updated_at before update on public.acc_manual_journals for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- helpers

-- Why an account cannot be made inactive or given sub-accounts, or null when it can: a posting role, an expense category or an
-- internal-use reason points at it.
create or replace function public.acc__account_in_use(p_org uuid, p_account uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'used by the posting role ' || min(role_key) from public.acc_account_roles where org_id = p_org and account_id = p_account having count(*) > 0),
    (select 'used by the expense category ' || min(name) from public.fin_categories where org_id = p_org and account_id = p_account having count(*) > 0),
    (select 'used by the internal-use reason ' || min(name) from public.acc_issue_reasons where org_id = p_org and account_id = p_account and active having count(*) > 0));
$$;
revoke all on function public.acc__account_in_use(uuid, uuid) from public, anon, authenticated;

-- True when the caller may post without approval: the owner, or an owner/admin marked head accountant (Ben's Q5).
create or replace function public.acc__can_post_direct(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null
                   and (m.role = 'owner' or (m.role = 'admin' and m.is_head_accountant)));
$$;
revoke all on function public.acc__can_post_direct(uuid) from public, anon, authenticated;

-- Owner or admin of a company with accounting on.
create or replace function public.acc__journal_guard() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('read');
begin
  if not public.acc__enabled(v_org) then raise exception 'MODULE_DISABLED' using detail = 'switch accounting on first'; end if;
  return v_org;
end $$;
revoke all on function public.acc__journal_guard() from public, anon, authenticated;

-- Posts a journal's lines as an entry and marks it posted. Internal.
create or replace function public.acc__post_journal(p_org uuid, p_id uuid, p_approved_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.acc_manual_journals; v_lines jsonb; v_entry uuid;
begin
  select * into j from public.acc_manual_journals where org_id = p_org and id = p_id for update;
  select jsonb_agg(jsonb_build_object('account', account_id, 'debit', debit_minor, 'credit', credit_minor, 'partyType', party_type,
           'partyId', party_id, 'memo', memo) order by line_no) into v_lines
    from public.acc_manual_journal_lines where org_id = p_org and journal_id = p_id;
  v_entry := public.acc__post(p_org, j.entry_date, j.currency, 'manual_journal', j.id::text, case when j.kind = 'opening' then 'opening' else 'posted' end,
                              j.number || ': ' || j.memo, v_lines, false, null, p_approved_by);
  return v_entry;
end $$;
revoke all on function public.acc__post_journal(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the audit fix: accounts in use (replaces the 045 versions)

create or replace function public.acc_create_account(p_parent_id uuid, p_code text, p_name text, p_name_ar text default null, p_kind text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); p public.acc_accounts; v_kind text; v_id uuid; v_code text := trim(coalesce(p_code, '')); v_use text;
begin
  if v_code !~ '^[0-9]{1,20}$' or length(trim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception 'INVALID_INPUT' using detail = 'a numeric code and a name are required';
  end if;
  if p_parent_id is null then
    if p_kind is null or p_kind not in ('asset', 'liability', 'equity', 'expense', 'revenue') then raise exception 'INVALID_INPUT' using detail = 'a top-level account needs a kind'; end if;
    v_kind := p_kind;
  else
    select * into p from public.acc_accounts where org_id = v_org and id = p_parent_id and deleted_at is null for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not (v_code like p.code || '%') or length(v_code) <= length(p.code) then
      raise exception 'INVALID_INPUT' using detail = format('the code must start with %s and be longer', p.code);
    end if;
    if exists (select 1 from public.acc_entry_lines where org_id = v_org and account_id = p.id)
       or exists (select 1 from public.acc_manual_journal_lines l join public.acc_manual_journals j on j.id = l.journal_id
                   where l.org_id = v_org and l.account_id = p.id and j.status = 'draft') then
      raise exception 'HAS_ENTRIES' using detail = format('%s already has entries or draft journal lines, so it cannot get sub-accounts', p.code);
    end if;
    v_use := public.acc__account_in_use(v_org, p.id);
    if v_use is not null then raise exception 'IN_USE' using detail = format('%s is %s; point it at another account first', p.code, v_use); end if;
    v_kind := p.kind;
    if p_kind is not null and p_kind <> p.kind then
      if p.kind in ('equity', 'liability') and p_kind in ('equity', 'liability') then v_kind := p_kind;
      else raise exception 'INVALID_INPUT' using detail = format('a sub-account of %s must be %s', p.code, p.kind); end if;
    end if;
  end if;
  if exists (select 1 from public.acc_accounts where org_id = v_org and code = v_code and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = format('code %s is already used', v_code);
  end if;
  insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
  values (v_org, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar, '')), ''), p_parent_id, v_kind, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.account.added', 'account', v_id::text, format('%s %s', v_code, trim(p_name)),
          jsonb_build_object('code', v_code, 'name', trim(p_name), 'name_ar', p_name_ar, 'kind', v_kind, 'parent_id', p_parent_id));
  return v_id;
end $$;

create or replace function public.acc_update_account(p_id uuid, p_name text, p_name_ar text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); a public.acc_accounts; v_use text;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 160 or p_active is null then raise exception 'INVALID_INPUT'; end if;
  select * into a from public.acc_accounts where org_id = v_org and id = p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.active and not p_active then
    v_use := public.acc__account_in_use(v_org, a.id);
    if v_use is not null then raise exception 'IN_USE' using detail = format('%s is %s', a.code, v_use); end if;
    if exists (select 1 from public.acc_accounts where org_id = v_org and parent_id = a.id and deleted_at is null and active) then
      raise exception 'IN_USE' using detail = format('%s has active sub-accounts', a.code);
    end if;
  end if;
  if a.name = trim(p_name) and a.name_ar is not distinct from nullif(trim(coalesce(p_name_ar, '')), '') and a.active = p_active then return; end if;
  update public.acc_accounts set name = trim(p_name), name_ar = nullif(trim(coalesce(p_name_ar, '')), ''), active = p_active where id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.account.changed', 'account', a.id::text, format('%s %s', a.code, trim(p_name)),
          jsonb_build_object('name', a.name, 'name_ar', a.name_ar, 'active', a.active),
          jsonb_build_object('name', trim(p_name), 'name_ar', nullif(trim(coalesce(p_name_ar, '')), ''), 'active', p_active));
end $$;

-- ---------------------------------------------------------------- manual journals

-- Create (p_id null) or replace a draft, then optionally post it directly (owner or head accountant only).
-- p_lines: [{"accountId": uuid, "debitMinor": n | "creditMinor": n, "partyType": "customer"|"supplier", "partyId": uuid, "memo": text}, ...]
-- Rules checked here, before anything is written: at least two lines, debits = credits, each line one side only, active leaf accounts
-- of this company, parties of this company, the date after the lock date; an opening journal is dated the first day of a fiscal year.
-- Only the author edits their draft.
create or replace function public.acc_save_journal(p_id uuid, p_entry_date date, p_memo text, p_lines jsonb,
  p_kind text default 'manual', p_currency text default null, p_post boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.acc__journal_guard(); j public.acc_manual_journals; v_id uuid; v_no text; v_cur text; l jsonb; v_n int := 0;
  v_acct uuid; v_dr bigint; v_cr bigint; v_tdr bigint := 0; v_tcr bigint := 0; v_pt text; v_pid uuid; v_entry uuid;
begin
  if p_entry_date is null or length(trim(coalesce(p_memo, ''))) not between 1 and 500 or p_kind not in ('manual', 'opening')
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 or jsonb_array_length(p_lines) > 500 then
    raise exception 'INVALID_INPUT' using detail = 'a date, a description and at least two lines are required';
  end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT' using detail = 'currency'; end if;
  perform public.core__assert_open(v_org, p_entry_date);
  if p_kind = 'opening' and not exists (select 1 from public.acc_fiscal_years where org_id = v_org and starts_on = p_entry_date) then
    raise exception 'INVALID_INPUT' using detail = 'opening balances are dated the first day of a fiscal year; add the fiscal year first';
  end if;
  -- validate every line before writing anything
  for l in select * from jsonb_array_elements(p_lines) loop
    begin
      v_acct := (l ->> 'accountId')::uuid; v_dr := coalesce((l ->> 'debitMinor')::bigint, 0); v_cr := coalesce((l ->> 'creditMinor')::bigint, 0);
      v_pt := nullif(l ->> 'partyType', ''); v_pid := (nullif(l ->> 'partyId', ''))::uuid;
    exception when others then raise exception 'INVALID_INPUT' using detail = 'a line is not valid';
    end;
    if v_acct is null or v_dr < 0 or v_cr < 0 or (v_dr > 0) = (v_cr > 0) then
      raise exception 'INVALID_INPUT' using detail = 'each line needs an account and either a debit or a credit above zero';
    end if;
    if not exists (select 1 from public.acc_accounts a where a.org_id = v_org and a.id = v_acct and a.deleted_at is null and a.active) then
      raise exception 'ACCOUNT_INACTIVE' using detail = 'each line needs an active account of this company';
    end if;
    if exists (select 1 from public.acc_accounts c where c.org_id = v_org and c.parent_id = v_acct and c.deleted_at is null) then raise exception 'NOT_LEAF'; end if;
    if (v_pt is null) <> (v_pid is null) or (v_pt is not null and v_pt not in ('customer', 'supplier'))
       or (v_pt = 'customer' and not exists (select 1 from public.sal_customers where org_id = v_org and id = v_pid))
       or (v_pt = 'supplier' and not exists (select 1 from public.pur_suppliers where org_id = v_org and id = v_pid)) then
      raise exception 'INVALID_INPUT' using detail = 'a line''s customer or supplier is not valid';
    end if;
    v_tdr := v_tdr + v_dr; v_tcr := v_tcr + v_cr;
  end loop;
  if v_tdr <> v_tcr then raise exception 'UNBALANCED' using detail = format('debits %s, credits %s', v_tdr, v_tcr); end if;

  if p_id is null then
    v_no := public.acc__next(v_org, 'acc_journal', 'MJ-');
    insert into public.acc_manual_journals (org_id, number, kind, entry_date, currency, memo, created_by)
    values (v_org, v_no, p_kind, p_entry_date, v_cur, trim(p_memo), auth.uid()) returning id into v_id;
  else
    select * into j from public.acc_manual_journals where org_id = v_org and id = p_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if j.status <> 'draft' then raise exception 'INVALID_STATE' using detail = 'only a draft can be changed'; end if;
    if j.created_by <> auth.uid() then raise exception 'FORBIDDEN' using detail = 'only the author changes a draft'; end if;
    update public.acc_manual_journals set kind = p_kind, entry_date = p_entry_date, currency = v_cur, memo = trim(p_memo) where id = j.id;
    delete from public.acc_manual_journal_lines where org_id = v_org and journal_id = j.id;
    v_id := j.id; v_no := j.number;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    insert into public.acc_manual_journal_lines (org_id, journal_id, line_no, account_id, debit_minor, credit_minor, party_type, party_id, memo)
    values (v_org, v_id, v_n, (l ->> 'accountId')::uuid, coalesce((l ->> 'debitMinor')::bigint, 0), coalesce((l ->> 'creditMinor')::bigint, 0),
            nullif(l ->> 'partyType', ''), (nullif(l ->> 'partyId', ''))::uuid, nullif(trim(coalesce(l ->> 'memo', '')), ''));
  end loop;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), case when p_id is null then 'accounting.journal.drafted' else 'accounting.journal.changed' end, 'manual_journal', v_id::text,
          format('%s %s: %s (%s %s)', v_no, p_kind, trim(p_memo), v_tdr, v_cur), jsonb_build_object('date', p_entry_date, 'total_minor', v_tdr, 'lines', v_n));

  if coalesce(p_post, false) then
    if not public.acc__can_post_direct(v_org) then raise exception 'FORBIDDEN' using detail = 'only the owner or the head accountant posts without approval'; end if;
    v_entry := public.acc__post_journal(v_org, v_id, null);
    update public.acc_manual_journals set status = 'posted', direct = true, entry_id = v_entry where id = v_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (v_org, auth.uid(), 'accounting.journal.posted_direct', 'manual_journal', v_id::text, format('%s posted without approval', v_no),
            jsonb_build_object('entry_id', v_entry));
  end if;
  return jsonb_build_object('id', v_id, 'number', v_no, 'status', case when coalesce(p_post, false) then 'posted' else 'draft' end, 'entryId', v_entry);
end $$;

-- Approve (posts it) or reject someone else's draft. Owner or admin; never one's own (SELF_APPROVAL; also a check constraint).
create or replace function public.acc_decide_journal(p_id uuid, p_decision text, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__journal_guard(); j public.acc_manual_journals; v_entry uuid;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_INPUT'; end if;
  select * into j from public.acc_manual_journals where org_id = v_org and id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if j.status <> 'draft' then raise exception 'INVALID_STATE' using detail = format('%s is %s', j.number, j.status); end if;
  if j.created_by = auth.uid() then raise exception 'SELF_APPROVAL' using detail = 'someone else must approve your journal'; end if;
  perform public.core__assert_open(v_org, j.entry_date);
  if p_decision = 'approved' then
    v_entry := public.acc__post_journal(v_org, j.id, auth.uid());
    update public.acc_manual_journals set status = 'posted', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(coalesce(p_comment, '')), ''), entry_id = v_entry where id = j.id;
  else
    update public.acc_manual_journals set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(coalesce(p_comment, '')), '') where id = j.id;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.journal.' || p_decision, 'manual_journal', j.id::text, format('%s %s', j.number, p_decision),
          jsonb_build_object('entry_id', v_entry, 'comment', p_comment));
  return jsonb_build_object('id', j.id, 'number', j.number, 'status', case when p_decision = 'approved' then 'posted' else 'rejected' end, 'entryId', v_entry);
end $$;

-- The author withdraws their own draft.
create or replace function public.acc_cancel_journal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__journal_guard(); j public.acc_manual_journals;
begin
  select * into j from public.acc_manual_journals where org_id = v_org and id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if j.status <> 'draft' then raise exception 'INVALID_STATE'; end if;
  if j.created_by <> auth.uid() then raise exception 'FORBIDDEN'; end if;
  update public.acc_manual_journals set status = 'cancelled' where id = j.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'accounting.journal.cancelled', 'manual_journal', j.id::text, format('%s withdrawn by its author', j.number));
end $$;

-- Correct a posted manual journal: a reversing entry dated p_date (after the lock date). Owner or head accountant (a reversal undoes
-- an approved entry, so it needs the same standing as posting directly). Once only.
create or replace function public.acc_reverse_journal(p_id uuid, p_date date, p_memo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__journal_guard(); j public.acc_manual_journals; v_entry uuid;
begin
  if p_date is null or length(trim(coalesce(p_memo, ''))) not between 1 and 500 then raise exception 'INVALID_INPUT' using detail = 'a date and a reason are required'; end if;
  if not public.acc__can_post_direct(v_org) then raise exception 'FORBIDDEN' using detail = 'only the owner or the head accountant reverses a journal'; end if;
  select * into j from public.acc_manual_journals where org_id = v_org and id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if j.status <> 'posted' then raise exception 'INVALID_STATE' using detail = 'only a posted journal can be reversed'; end if;
  if exists (select 1 from public.acc_entries where org_id = v_org and source_type = 'manual_journal' and source_id = j.id::text and event = 'reversed') then
    raise exception 'INVALID_STATE' using detail = format('%s is already reversed', j.number);
  end if;
  v_entry := public.acc__reverse(v_org, j.entry_id, p_date, 'reversed', 'Reversal of ' || j.number || ': ' || trim(p_memo));
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.journal.reversed', 'manual_journal', j.id::text, format('%s reversed: %s', j.number, trim(p_memo)),
          jsonb_build_object('entry_id', v_entry, 'date', p_date));
  return v_entry;
end $$;

-- Tidy-up found by the privilege audit of 045-047: the append-only trigger function (045) kept the default EXECUTE for everyone.
-- Harmless (a trigger function cannot be called directly) but closed like every other internal function.
revoke all on function public.acc__append_only() from public, anon, authenticated;

revoke all on function public.acc_save_journal(uuid, date, text, jsonb, text, text, boolean), public.acc_decide_journal(uuid, text, text),
  public.acc_cancel_journal(uuid), public.acc_reverse_journal(uuid, date, text) from public, anon;
grant execute on function public.acc_save_journal(uuid, date, text, jsonb, text, text, boolean), public.acc_decide_journal(uuid, text, text),
  public.acc_cancel_journal(uuid), public.acc_reverse_journal(uuid, date, text) to authenticated;

commit;

-- Verification (read-only): RLS on, no user writes, the approval check constraint exists, functions open to signed-in users only.
select relname, relrowsecurity from pg_class where relname in ('acc_manual_journals', 'acc_manual_journal_lines') order by 1;
select count(*) as user_write_grants from information_schema.role_table_grants
 where table_name in ('acc_manual_journals', 'acc_manual_journal_lines') and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
select count(*) as approval_constraints from pg_constraint where conname in ('acc_manual_journals_decider_not_author', 'acc_manual_journals_posted_has_decider');
select has_function_privilege('anon', 'public.acc_save_journal(uuid, date, text, jsonb, text, text, boolean)', 'execute') as anon_can_save,
       has_function_privilege('authenticated', 'public.acc__post_journal(uuid, uuid, uuid)', 'execute') as users_can_post_internal;
