-- sql/067_trs_bank_statements.sql
-- Bank statement import and reconciliation, part 1 (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md, approved by Ben 10 Nov 2026
-- with his answers to Q1-Q5). Module key: treasury. Rerun-safe. Needs sql/001-066.
--
-- Part 1: statements are imported (the browser reads the file; the server re-checks every line), lines already imported from an
-- overlapping file are skipped, a person matches bank lines to ledger lines of the bank account, unmatches or ignores (with a reason),
-- and closes a period when nothing is open and the balances agree. Part 2 (a later migration) adds "explain a line" (record the
-- missing payment, expense or transfer and match it at once) and description rules.
-- Rules:
--   * Matching moves no money: it only records "this bank line is that ledger line". Money moves only through the existing functions.
--   * Who may confirm matches, ignore lines and close or reopen periods is a company setting (Q2): organizations.settings
--     .bank_reconcile_roles, default ["owner","head_accountant"]; "owner" is always kept so someone can always reconcile.
--   * Importing needs owner or admin (the treasury module's readers).
--   * A ledger line is matched at most once (partial unique index); an undone match keeps its row (undone_at), so history stays.
--   * A closed period can be reopened by a person allowed by the setting, with a reason, never for a date on or before the lock date
--     (Q4, standard practice). Lines on or before a closed date cannot be matched, unmatched or ignored.
--   * Every action writes an audit row in the same transaction.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.trs_statement_formats (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  account_id  uuid not null,
  mapping     jsonb not null check (jsonb_typeof(mapping) = 'object'),
  updated_by  uuid not null references auth.users(id),
  updated_at  timestamptz not null default now(),
  unique (org_id, account_id),
  foreign key (org_id, account_id) references public.trs_accounts(org_id, id)
);

create table if not exists public.trs_statement_imports (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  account_id     uuid not null,
  file_name      text not null check (length(trim(file_name)) between 1 and 200),
  file_hash      text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_format    text not null check (file_format in ('csv', 'xlsx', 'docx', 'mt940', 'pdf')),
  period_from    date not null,
  period_to      date not null,
  opening_minor  bigint,
  closing_minor  bigint,
  lines_added    int not null default 0,
  lines_skipped  int not null default 0,
  imported_by    uuid not null references auth.users(id),
  imported_at    timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, account_id, file_hash),
  check (period_from <= period_to),
  foreign key (org_id, account_id) references public.trs_accounts(org_id, id)
);

create table if not exists public.trs_statement_lines (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  import_id      uuid not null,
  account_id     uuid not null,
  line_no        int not null check (line_no > 0),
  booking_date   date not null,
  value_date     date,
  description    text not null default '' check (length(description) <= 500),
  reference      text not null default '' check (length(reference) <= 140),
  amount_minor   bigint not null check (amount_minor <> 0),
  balance_minor  bigint,
  fingerprint    text not null check (length(fingerprint) between 1 and 800),
  status         text not null default 'open' check (status in ('open', 'matched', 'ignored')),
  ignore_reason  text check (ignore_reason is null or length(trim(ignore_reason)) between 1 and 300),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  unique (org_id, id),
  unique (org_id, account_id, fingerprint),
  check ((status = 'ignored') = (ignore_reason is not null)),
  foreign key (org_id, import_id) references public.trs_statement_imports(org_id, id),
  foreign key (org_id, account_id) references public.trs_accounts(org_id, id)
);
create index if not exists trs_statement_lines_open_idx on public.trs_statement_lines (org_id, account_id, booking_date) where status = 'open';

create table if not exists public.trs_statement_matches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  line_id        uuid not null,
  entry_line_id  bigint not null references public.acc_entry_lines(id),
  amount_minor   bigint not null check (amount_minor <> 0),
  matched_by     uuid not null references auth.users(id),
  matched_at     timestamptz not null default now(),
  undone_by      uuid references auth.users(id),
  undone_at      timestamptz,
  foreign key (org_id, line_id) references public.trs_statement_lines(org_id, id),
  check ((undone_by is null) = (undone_at is null))
);
-- A ledger line is matched at most once (undone matches do not count).
create unique index if not exists trs_statement_matches_entry_once on public.trs_statement_matches (entry_line_id) where undone_at is null;
create index if not exists trs_statement_matches_line_idx on public.trs_statement_matches (org_id, line_id);

create table if not exists public.trs_reconciliations (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id),
  account_id             uuid not null,
  to_date                date not null,
  bank_closing_minor     bigint not null,
  ledger_balance_minor   bigint not null,
  unmatched_ledger_minor bigint not null,
  ignored_bank_minor     bigint not null,
  status                 text not null default 'closed' check (status in ('closed', 'reopened')),
  closed_by              uuid not null references auth.users(id),
  closed_at              timestamptz not null default now(),
  reopened_by            uuid references auth.users(id),
  reopened_at            timestamptz,
  reopen_reason          text check (reopen_reason is null or length(trim(reopen_reason)) between 1 and 300),
  check ((status = 'reopened') = (reopened_by is not null and reopened_at is not null and reopen_reason is not null)),
  foreign key (org_id, account_id) references public.trs_accounts(org_id, id)
);
create index if not exists trs_reconciliations_account_idx on public.trs_reconciliations (org_id, account_id, to_date desc);

-- Read: owners and admins (as the rest of treasury). No user writes.
alter table public.trs_statement_formats enable row level security;
alter table public.trs_statement_imports enable row level security;
alter table public.trs_statement_lines enable row level security;
alter table public.trs_statement_matches enable row level security;
alter table public.trs_reconciliations enable row level security;
revoke all on public.trs_statement_formats, public.trs_statement_imports, public.trs_statement_lines, public.trs_statement_matches,
  public.trs_reconciliations from anon, authenticated;
grant select on public.trs_statement_formats, public.trs_statement_imports, public.trs_statement_lines, public.trs_statement_matches,
  public.trs_reconciliations to authenticated;
drop policy if exists trs_statement_formats_read on public.trs_statement_formats;
create policy trs_statement_formats_read on public.trs_statement_formats for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists trs_statement_imports_read on public.trs_statement_imports;
create policy trs_statement_imports_read on public.trs_statement_imports for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists trs_statement_lines_read on public.trs_statement_lines;
create policy trs_statement_lines_read on public.trs_statement_lines for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists trs_statement_matches_read on public.trs_statement_matches;
create policy trs_statement_matches_read on public.trs_statement_matches for select to authenticated using (public.acc__can_read(org_id));
drop policy if exists trs_reconciliations_read on public.trs_reconciliations;
create policy trs_reconciliations_read on public.trs_reconciliations for select to authenticated using (public.acc__can_read(org_id));

-- ---------------------------------------------------------------- who may reconcile (Q2)

-- The caller may confirm matches, ignore lines and close or reopen periods: their role is in the company's list ("owner", "admin",
-- or "head_accountant" for a member flagged head accountant). Default list: owner and head accountant.
create or replace function public.trs__can_reconcile(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with roles as (
    select coalesce(o.settings -> 'bank_reconcile_roles', '["owner", "head_accountant"]'::jsonb) as r from public.organizations o where o.id = p_org
  )
  select exists (
    select 1 from public.memberships m, roles
     where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null
       and ((m.role = 'owner' and roles.r ? 'owner') or (m.role = 'admin' and roles.r ? 'admin')
            or (m.is_head_accountant and roles.r ? 'head_accountant'))
  );
$$;
revoke all on function public.trs__can_reconcile(uuid) from public, anon, authenticated;

-- Reconcile guard: treasury readers (owner or admin, treasury on) who are in the list.
create or replace function public.trs__reconcile_guard() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__guard('read');
begin
  if not public.trs__can_reconcile(v_org) then raise exception 'FORBIDDEN' using detail = 'your role may not reconcile bank statements in this company'; end if;
  return v_org;
end $$;
revoke all on function public.trs__reconcile_guard() from public, anon, authenticated;

-- Owner only. p_roles: any of owner, admin, head_accountant; owner is always kept.
create or replace function public.trs_set_reconcile_roles(p_roles text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__guard('read'); v_roles text[];
begin
  if not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.role = 'owner' and m.disabled_at is null) then
    raise exception 'FORBIDDEN';
  end if;
  if p_roles is null or exists (select 1 from unnest(p_roles) r where r not in ('owner', 'admin', 'head_accountant')) then raise exception 'INVALID_INPUT'; end if;
  select array_agg(distinct r order by r) into v_roles from unnest(array_append(p_roles, 'owner')) r;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('bank_reconcile_roles', to_jsonb(v_roles)) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.reconcile_roles_changed', 'organization', v_org::text, format('Bank reconciliation allowed for: %s', array_to_string(v_roles, ', ')));
  return v_roles;
end $$;

-- ---------------------------------------------------------------- helpers

-- The bank treasury account, active, in this company; returns its ledger account and currency.
create or replace function public.trs__bank_account(p_org uuid, p_account uuid) returns public.trs_accounts
language plpgsql stable security definer set search_path = public as $$
declare a public.trs_accounts;
begin
  select * into a from public.trs_accounts where org_id = p_org and id = p_account;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.kind <> 'bank' or not a.active then raise exception 'INVALID_INPUT' using detail = 'choose an active bank account'; end if;
  return a;
end $$;
revoke all on function public.trs__bank_account(uuid, uuid) from public, anon, authenticated;

-- The latest closed (not reopened) reconciliation date of an account, or null.
create or replace function public.trs__closed_to(p_org uuid, p_account uuid) returns date
language sql stable security definer set search_path = public as $$
  select max(to_date) from public.trs_reconciliations where org_id = p_org and account_id = p_account and status = 'closed';
$$;
revoke all on function public.trs__closed_to(uuid, uuid) from public, anon, authenticated;

-- A statement line of this company, locked, not in a closed period.
create or replace function public.trs__open_period_line(p_org uuid, p_line uuid) returns public.trs_statement_lines
language plpgsql security definer set search_path = public as $$
declare l public.trs_statement_lines; v_closed date;
begin
  select * into l from public.trs_statement_lines where org_id = p_org and id = p_line for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_closed := public.trs__closed_to(p_org, l.account_id);
  if v_closed is not null and l.booking_date <= v_closed then
    raise exception 'INVALID_STATE' using detail = format('the period up to %s is reconciled and closed', v_closed);
  end if;
  return l;
end $$;
revoke all on function public.trs__open_period_line(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- formats

create or replace function public.trs_save_statement_format(p_account_id uuid, p_mapping jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__guard('read'); a public.trs_accounts;
begin
  a := public.trs__bank_account(v_org, p_account_id);
  if jsonb_typeof(p_mapping) is distinct from 'object' or length(p_mapping::text) > 4000 then raise exception 'INVALID_INPUT'; end if;
  insert into public.trs_statement_formats (org_id, account_id, mapping, updated_by) values (v_org, a.id, p_mapping, auth.uid())
  on conflict (org_id, account_id) do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.statement_format_saved', 'treasury_account', a.id::text, format('Statement columns saved for %s', a.code));
end $$;

-- ---------------------------------------------------------------- import

-- p_lines: [{bookingDate, valueDate?, description?, reference?, amountMinor, balanceMinor?, fingerprint}], read in the browser by the
-- shared readers (bankStatements.ts, mt940.ts) and checked again here. Lines whose fingerprint is already imported for this account are
-- skipped (an overlapping file). The same file twice is refused (DUPLICATE_FILE). Lines on or before a closed period are refused.
create or replace function public.trs_import_statement(p_account_id uuid, p_file_name text, p_file_hash text, p_file_format text,
  p_opening_minor bigint, p_closing_minor bigint, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.trs__guard('read'); a public.trs_accounts; v_import uuid; e jsonb; n int := 0; v_added int := 0; v_skipped int := 0;
  v_date date; v_value date; v_amount bigint; v_fp text; v_from date; v_to date; v_closed date;
begin
  a := public.trs__bank_account(v_org, p_account_id);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 5000 then
    raise exception 'INVALID_INPUT' using detail = 'between 1 and 5000 lines';
  end if;
  if p_file_hash !~ '^[0-9a-f]{64}$' or p_file_format not in ('csv', 'xlsx', 'docx', 'mt940', 'pdf') or length(trim(coalesce(p_file_name, ''))) = 0 then
    raise exception 'INVALID_INPUT';
  end if;
  if exists (select 1 from public.trs_statement_imports where org_id = v_org and account_id = a.id and file_hash = p_file_hash) then
    raise exception 'DUPLICATE_FILE' using detail = 'this file was already imported for this account';
  end if;
  select min((x ->> 'bookingDate')::date), max((x ->> 'bookingDate')::date) into v_from, v_to from jsonb_array_elements(p_lines) x;
  v_closed := public.trs__closed_to(v_org, a.id);
  if v_closed is not null and v_from <= v_closed then
    raise exception 'INVALID_STATE' using detail = format('the period up to %s is reconciled and closed', v_closed);
  end if;
  insert into public.trs_statement_imports (org_id, account_id, file_name, file_hash, file_format, period_from, period_to, opening_minor, closing_minor, imported_by)
  values (v_org, a.id, left(trim(p_file_name), 200), p_file_hash, p_file_format, v_from, v_to, p_opening_minor, p_closing_minor, auth.uid())
  returning id into v_import;
  for e in select value from jsonb_array_elements(p_lines) loop
    n := n + 1;
    begin
      v_date := (e ->> 'bookingDate')::date; v_value := nullif(e ->> 'valueDate', '')::date; v_amount := (e ->> 'amountMinor')::bigint;
      v_fp := e ->> 'fingerprint';
    exception when others then raise exception 'INVALID_INPUT' using detail = format('line %s cannot be read', n);
    end;
    if v_date is null or v_amount is null or v_amount = 0 or v_fp is null or length(v_fp) = 0 then
      raise exception 'INVALID_INPUT' using detail = format('line %s needs a date, an amount and a fingerprint', n);
    end if;
    if exists (select 1 from public.trs_statement_lines where org_id = v_org and account_id = a.id and fingerprint = v_fp) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.trs_statement_lines (org_id, import_id, account_id, line_no, booking_date, value_date, description, reference, amount_minor, balance_minor, fingerprint)
    values (v_org, v_import, a.id, n, v_date, v_value, left(coalesce(e ->> 'description', ''), 500), left(coalesce(e ->> 'reference', ''), 140), v_amount,
            nullif(e ->> 'balanceMinor', '')::bigint, left(v_fp, 800));
    v_added := v_added + 1;
  end loop;
  update public.trs_statement_imports set lines_added = v_added, lines_skipped = v_skipped where id = v_import;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.statement_imported', 'statement_import', v_import::text,
          format('%s for %s: %s line(s) added, %s already imported', left(trim(p_file_name), 200), a.code, v_added, v_skipped));
  return jsonb_build_object('id', v_import, 'added', v_added, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------- matching

-- Match one bank line to one or more ledger lines of the bank account's ledger account. Each ledger line: same company, posted to
-- that account, in the line's direction, not matched already; together exactly the bank line's amount.
create or replace function public.trs_match_line(p_line_id uuid, p_entry_line_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.trs__reconcile_guard(); l public.trs_statement_lines; a public.trs_accounts; v_sum bigint; v_n int; r record;
begin
  l := public.trs__open_period_line(v_org, p_line_id);
  if l.status <> 'open' then raise exception 'INVALID_STATE' using detail = format('the line is %s', l.status); end if;
  if p_entry_line_ids is null or cardinality(p_entry_line_ids) = 0 or cardinality(p_entry_line_ids) > 20 then raise exception 'INVALID_INPUT'; end if;
  select * into a from public.trs_accounts where org_id = v_org and id = l.account_id;
  select count(*), coalesce(sum(el.debit_minor - el.credit_minor), 0) into v_n, v_sum
    from public.acc_entry_lines el join public.acc_entries en on en.org_id = el.org_id and en.id = el.entry_id
   where el.org_id = v_org and el.id = any (p_entry_line_ids) and el.account_id = a.ledger_account_id and en.currency = a.currency;
  if v_n <> cardinality(p_entry_line_ids) then raise exception 'INVALID_INPUT' using detail = 'a ledger line is not on this bank account'; end if;
  if exists (select 1 from public.acc_entry_lines el where el.id = any (p_entry_line_ids) and sign(el.debit_minor - el.credit_minor) <> sign(l.amount_minor)) then
    raise exception 'INVALID_INPUT' using detail = 'money in matches money in, money out matches money out';
  end if;
  if v_sum <> l.amount_minor then raise exception 'INVALID_INPUT' using detail = format('the ledger lines add up to %s, the bank line is %s', v_sum, l.amount_minor); end if;
  if exists (select 1 from public.trs_statement_matches m where m.entry_line_id = any (p_entry_line_ids) and m.undone_at is null) then
    raise exception 'INVALID_STATE' using detail = 'a ledger line is already matched';
  end if;
  for r in select el.id, el.debit_minor - el.credit_minor as amt from public.acc_entry_lines el where el.id = any (p_entry_line_ids) loop
    insert into public.trs_statement_matches (org_id, line_id, entry_line_id, amount_minor, matched_by) values (v_org, l.id, r.id, r.amt, auth.uid());
  end loop;
  update public.trs_statement_lines set status = 'matched', decided_by = auth.uid(), decided_at = now() where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.statement_line_matched', 'statement_line', l.id::text,
          format('%s %s on %s matched to %s ledger line(s)', a.code, l.amount_minor, l.booking_date, cardinality(p_entry_line_ids)));
end $$;

create or replace function public.trs_unmatch_line(p_line_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__reconcile_guard(); l public.trs_statement_lines;
begin
  l := public.trs__open_period_line(v_org, p_line_id);
  if l.status = 'open' then raise exception 'INVALID_STATE' using detail = 'the line is not matched or ignored'; end if;
  update public.trs_statement_matches set undone_by = auth.uid(), undone_at = now() where org_id = v_org and line_id = l.id and undone_at is null;
  update public.trs_statement_lines set status = 'open', ignore_reason = null, decided_by = null, decided_at = null where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.statement_line_reopened', 'statement_line', l.id::text, format('Line %s on %s back to open (was %s)', l.amount_minor, l.booking_date, l.status));
end $$;

create or replace function public.trs_ignore_line(p_line_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__reconcile_guard(); l public.trs_statement_lines;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a reason is required'; end if;
  l := public.trs__open_period_line(v_org, p_line_id);
  if l.status <> 'open' then raise exception 'INVALID_STATE' using detail = format('the line is %s', l.status); end if;
  update public.trs_statement_lines set status = 'ignored', ignore_reason = left(trim(p_reason), 300), decided_by = auth.uid(), decided_at = now() where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.statement_line_ignored', 'statement_line', l.id::text, format('Line %s on %s ignored: %s', l.amount_minor, l.booking_date, left(trim(p_reason), 300)));
end $$;

-- ---------------------------------------------------------------- closing a period

-- Close the account's reconciliation up to p_to_date. Needs: no open bank line up to that date; and
--   bank closing = ledger balance on that date - ledger lines not matched yet + bank lines ignored.
create or replace function public.trs_close_reconciliation(p_account_id uuid, p_to_date date, p_bank_closing_minor bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.trs__reconcile_guard(); a public.trs_accounts; v_ledger bigint; v_unmatched bigint; v_ignored bigint; v_open int; v_id uuid;
begin
  a := public.trs__bank_account(v_org, p_account_id);
  if p_to_date is null or p_bank_closing_minor is null then raise exception 'INVALID_INPUT'; end if;
  if p_to_date <= coalesce(public.trs__closed_to(v_org, a.id), '-infinity'::date) then raise exception 'INVALID_STATE' using detail = 'already closed to that date'; end if;
  select count(*) into v_open from public.trs_statement_lines where org_id = v_org and account_id = a.id and status = 'open' and booking_date <= p_to_date;
  if v_open > 0 then raise exception 'INVALID_STATE' using detail = format('%s bank line(s) up to that date are still open', v_open); end if;
  v_ledger := public.trs__ledger_balance(v_org, a.ledger_account_id, a.currency, p_to_date);
  select coalesce(sum(el.debit_minor - el.credit_minor), 0) into v_unmatched
    from public.acc_entry_lines el join public.acc_entries en on en.org_id = el.org_id and en.id = el.entry_id
   where el.org_id = v_org and el.account_id = a.ledger_account_id and en.currency = a.currency and en.entry_date <= p_to_date
     and not exists (select 1 from public.trs_statement_matches m where m.entry_line_id = el.id and m.undone_at is null);
  select coalesce(sum(amount_minor), 0) into v_ignored from public.trs_statement_lines
   where org_id = v_org and account_id = a.id and status = 'ignored' and booking_date <= p_to_date;
  if p_bank_closing_minor <> v_ledger - v_unmatched + v_ignored then
    raise exception 'RECONCILE_DIFFERENCE' using detail = format('bank %s, books %s, not yet at the bank %s, ignored at the bank %s: difference %s',
      p_bank_closing_minor, v_ledger, v_unmatched, v_ignored, p_bank_closing_minor - (v_ledger - v_unmatched + v_ignored));
  end if;
  insert into public.trs_reconciliations (org_id, account_id, to_date, bank_closing_minor, ledger_balance_minor, unmatched_ledger_minor, ignored_bank_minor, closed_by)
  values (v_org, a.id, p_to_date, p_bank_closing_minor, v_ledger, v_unmatched, v_ignored, auth.uid()) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.reconciliation_closed', 'reconciliation', v_id::text, format('%s reconciled to %s (bank %s)', a.code, p_to_date, p_bank_closing_minor));
  return jsonb_build_object('id', v_id, 'ledgerMinor', v_ledger, 'unmatchedLedgerMinor', v_unmatched, 'ignoredBankMinor', v_ignored);
end $$;

-- Reopen the latest closed reconciliation of an account, with a reason; never one on or before the lock date.
create or replace function public.trs_reopen_reconciliation(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.trs__reconcile_guard(); r public.trs_reconciliations; a public.trs_accounts;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a reason is required'; end if;
  select * into r from public.trs_reconciliations where org_id = v_org and id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'closed' then raise exception 'INVALID_STATE' using detail = 'already reopened'; end if;
  if r.to_date <> public.trs__closed_to(v_org, r.account_id) then raise exception 'INVALID_STATE' using detail = 'reopen the latest closed period first'; end if;
  perform public.core__assert_open(v_org, r.to_date);
  update public.trs_reconciliations set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = left(trim(p_reason), 300) where id = r.id;
  select * into a from public.trs_accounts where org_id = v_org and id = r.account_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'treasury.reconciliation_reopened', 'reconciliation', r.id::text, format('%s reconciliation to %s reopened: %s', a.code, r.to_date, left(trim(p_reason), 300)));
end $$;

revoke all on function public.trs_set_reconcile_roles(text[]), public.trs_save_statement_format(uuid, jsonb),
  public.trs_import_statement(uuid, text, text, text, bigint, bigint, jsonb), public.trs_match_line(uuid, bigint[]), public.trs_unmatch_line(uuid),
  public.trs_ignore_line(uuid, text), public.trs_close_reconciliation(uuid, date, bigint), public.trs_reopen_reconciliation(uuid, text) from public, anon;
grant execute on function public.trs_set_reconcile_roles(text[]), public.trs_save_statement_format(uuid, jsonb),
  public.trs_import_statement(uuid, text, text, text, bigint, bigint, jsonb), public.trs_match_line(uuid, bigint[]), public.trs_unmatch_line(uuid),
  public.trs_ignore_line(uuid, text), public.trs_close_reconciliation(uuid, date, bigint), public.trs_reopen_reconciliation(uuid, text) to authenticated;

commit;

-- Verification (read-only): RLS on the five tables; no user writes; anonymous cannot import.
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace
   and relname in ('trs_statement_formats', 'trs_statement_imports', 'trs_statement_lines', 'trs_statement_matches', 'trs_reconciliations') order by relname;
select count(*) as user_write_grants from information_schema.role_table_grants
 where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name like 'trs_statement%' and privilege_type <> 'SELECT';
select has_function_privilege('anon', 'public.trs_import_statement(uuid, text, text, text, bigint, bigint, jsonb)', 'execute') as anon_imports;
