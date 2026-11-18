-- 091_vat_settlement.sql
-- VAT part 4 (documentation/plans/VAT_PLAN.md section 15; Ben, 17 Nov: "build it now", every assumption changeable later): settlement
-- and carry-forward. No new way to post: every entry here is a manual journal (sql/048) with its approval (someone else approves it,
-- or the owner / head accountant posts directly), so it can be reversed like any journal.
--   * Role vat_settlement and account 2872 "VAT settlement" (liability, under 28), added to every chart and to new charts.
--   * acc_vat_periods: one closed VAT month per company (its closing journal and the figures); acc_vat_payments: payments to the tax
--     authority against a closed month. Company data: RLS, read for members, writes through the functions below, append-only.
--   * acc_vat_month(month): the month's VAT from the LEDGER (output VAT and input VAT accounts, entries dated in the month, leaving out
--     the VAT closing and payment journals themselves) beside the document summary (sql/089) and the difference; the close if any,
--     payments, the run of consecutive credit months, whether a refund can be asked for, and the return's due date.
--   * acc_vat_close_month(month, post): after the month has ended; a journal dated its last day: output VAT and input VAT cleared to
--     the settlement account (credit when VAT is due, debit when it is a credit carried forward). Once per month while its journal is
--     a draft or posted (a rejected or cancelled one frees the month; a posted one is undone by reversing it, sql/048).
--   * acc_vat_record_payment(period, account, amount, date, post): Dr settlement / Cr the bank or cash account, up to what is due.
--   * acc_vat_opening(amount, post): for a company that already files, the balance brought in at its "VAT from" date: a positive
--     amount is a credit carried forward (Dr settlement), a negative one VAT still owed (Cr settlement), against opening balances.
--   * core_set_vat_return(due_days, small_enterprise): owner; the return's due date (null = end of the following month) and the
--     small-enterprise flag (refund after more than 3 months instead of more than 4 periods; Law 6/2025, to confirm). Audited.
-- Needs accounting on (journals need the ledger). Depends on sql/001-090. Rerun-safe. Then run sql/tests/086_vat_settlement.sql.

begin;

-- ---------------------------------------------------------------- the settlement account

alter table public.acc_account_roles drop constraint if exists acc_account_roles_role_key_check;
alter table public.acc_account_roles add constraint acc_account_roles_role_key_check check (role_key in (
  'inventory', 'receivables', 'cash', 'bank', 'card_clearing', 'cheque_in_clearing', 'cheque_out_clearing', 'other_clearing',
  'opening_balance', 'payables', 'grni', 'expense_payables', 'expense_default', 'stock_adjustment', 'internal_use',
  'price_variance', 'cogs', 'sales_revenue', 'sales_returns', 'output_vat', 'input_vat', 'vat_settlement'));

-- Adds 2872 and points vat_settlement at it, for a company with a chart (as sql/086 did for 2871 and 1811). Returns accounts added.
create or replace function public.acc__ensure_vat_settlement(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_parent uuid; v_id uuid;
begin
  if not exists (select 1 from public.acc_accounts where org_id = p_org and deleted_at is null) then return 0; end if;
  if exists (select 1 from public.acc_account_roles where org_id = p_org and role_key = 'vat_settlement') then return 0; end if;
  select id into v_id from public.acc_accounts a where a.org_id = p_org and a.code = '2872' and a.deleted_at is null;
  if v_id is null then
    select id into v_parent from public.acc_accounts where org_id = p_org and code = '28' and deleted_at is null;
    insert into public.acc_accounts (org_id, code, name, name_ar, parent_id, kind, created_by)
    values (p_org, '2872', 'VAT settlement (due to or from the tax authority)', 'تسوية ضريبة القيمة المضافة (مستحق للمصلحة أو منها)', v_parent, 'liability', auth.uid())
    returning id into v_id;
    insert into public.acc_account_roles (org_id, role_key, account_id) values (p_org, 'vat_settlement', v_id) on conflict (org_id, role_key) do nothing;
    return 1;
  end if;
  if exists (select 1 from public.acc_accounts a where a.id = v_id and a.active)
     and not exists (select 1 from public.acc_accounts c where c.org_id = p_org and c.parent_id = v_id and c.deleted_at is null) then
    insert into public.acc_account_roles (org_id, role_key, account_id) values (p_org, 'vat_settlement', v_id) on conflict (org_id, role_key) do nothing;
  end if;
  return 0;
end $$;
revoke all on function public.acc__ensure_vat_settlement(uuid) from public, anon, authenticated;

-- sql/086's wrapper, plus 2872.
create or replace function public.acc__seed_chart(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  v_n := public.acc__seed_chart_base(p_org);
  if v_n = 0 then return 0; end if;
  return v_n + public.acc__ensure_vat_accounts(p_org) + public.acc__ensure_vat_settlement(p_org);
end $$;
revoke all on function public.acc__seed_chart(uuid) from public, anon, authenticated;

do $$
declare o record;
begin
  for o in select distinct a.org_id from public.acc_accounts a where a.deleted_at is null loop
    if public.acc__ensure_vat_settlement(o.org_id) > 0 then
      insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
      values (o.org_id, null, 'accounting.chart.vat_accounts_added', 'organization', o.org_id::text, 'VAT account added to the chart: 2872 VAT settlement');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- closed months and payments

create table if not exists public.acc_vat_periods (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  month            date not null check (extract(day from month) = 1),
  journal_id       uuid not null,
  output_minor     bigint not null,
  input_minor      bigint not null,
  due_minor        bigint not null,
  summary_due_minor bigint,
  currency         char(3) not null,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, journal_id) references public.acc_manual_journals (org_id, id)
);
create index if not exists acc_vat_periods_org_month_idx on public.acc_vat_periods (org_id, month);

create table if not exists public.acc_vat_payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  period_id    uuid not null,
  journal_id   uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  paid_on      date not null,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  foreign key (org_id, period_id) references public.acc_vat_periods (org_id, id),
  foreign key (org_id, journal_id) references public.acc_manual_journals (org_id, id)
);
create index if not exists acc_vat_payments_org_period_idx on public.acc_vat_payments (org_id, period_id);

alter table public.acc_vat_periods enable row level security;
alter table public.acc_vat_payments enable row level security;
revoke all on public.acc_vat_periods, public.acc_vat_payments from anon, authenticated;
grant select on public.acc_vat_periods, public.acc_vat_payments to authenticated;
drop policy if exists acc_vat_periods_member_read on public.acc_vat_periods;
create policy acc_vat_periods_member_read on public.acc_vat_periods for select to authenticated using (public.is_org_member(org_id));
drop policy if exists acc_vat_payments_member_read on public.acc_vat_payments;
create policy acc_vat_payments_member_read on public.acc_vat_payments for select to authenticated using (public.is_org_member(org_id));
drop trigger if exists acc_vat_periods_append_only on public.acc_vat_periods;
create trigger acc_vat_periods_append_only before update or delete on public.acc_vat_periods for each statement execute function public.inv_append_only();
drop trigger if exists acc_vat_periods_no_truncate on public.acc_vat_periods;
create trigger acc_vat_periods_no_truncate before truncate on public.acc_vat_periods for each statement execute function public.inv_append_only();
drop trigger if exists acc_vat_payments_append_only on public.acc_vat_payments;
create trigger acc_vat_payments_append_only before update or delete on public.acc_vat_payments for each statement execute function public.inv_append_only();
drop trigger if exists acc_vat_payments_no_truncate on public.acc_vat_payments;
create trigger acc_vat_payments_no_truncate before truncate on public.acc_vat_payments for each statement execute function public.inv_append_only();

-- ---------------------------------------------------------------- helpers (internal)

-- Output VAT (credit balance of the output VAT account) and input VAT (debit balance of the input VAT account) from entries dated in the
-- month, leaving out the VAT closing, payment and opening journals. {"output": n, "input": n}
create or replace function public.acc__vat_ledger(p_org uuid, p_month date) returns jsonb
language sql stable security definer set search_path = public as $$
  with acct as (select (select account_id from public.acc_account_roles where org_id = p_org and role_key = 'output_vat') as out_acct,
                       (select account_id from public.acc_account_roles where org_id = p_org and role_key = 'input_vat') as in_acct),
  own as (select journal_id::text as id from public.acc_vat_periods where org_id = p_org
          union all select journal_id::text from public.acc_vat_payments where org_id = p_org
          union all select (select o.settings ->> 'vat_opening_journal_id' from public.organizations o where o.id = p_org))
  select jsonb_build_object(
    'output', coalesce(sum(l.credit_minor - l.debit_minor) filter (where l.account_id = (select out_acct from acct)), 0),
    'input', coalesce(sum(l.debit_minor - l.credit_minor) filter (where l.account_id = (select in_acct from acct)), 0))
    from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
   where l.org_id = p_org and e.entry_date >= p_month and e.entry_date < (p_month + interval '1 month')::date
     and l.account_id in ((select out_acct from acct), (select in_acct from acct))
     and not (e.source_type = 'manual_journal' and e.source_id in (select id from own where id is not null))
$$;
revoke all on function public.acc__vat_ledger(uuid, date) from public, anon, authenticated;

-- The live close of a month: its period row while the journal is a draft or posted.
create or replace function public.acc__vat_live_period(p_org uuid, p_month date) returns public.acc_vat_periods
language sql stable security definer set search_path = public as $$
  select p.* from public.acc_vat_periods p join public.acc_manual_journals j on j.org_id = p.org_id and j.id = p.journal_id
   where p.org_id = p_org and p.month = p_month and j.status in ('draft', 'posted')
     and not exists (select 1 from public.acc_entries r join public.acc_entries x on x.org_id = r.org_id and x.id = r.reverses_entry_id
                      where r.org_id = p.org_id and x.id = j.entry_id)
   order by p.created_at desc limit 1
$$;
revoke all on function public.acc__vat_live_period(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- the month (read)

create or replace function public.acc_vat_month(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.acc__guard('read'); v_m date; v_end date; v_led jsonb; v_sum jsonb; p public.acc_vat_periods; v_status text; v_paid bigint := 0;
  v_streak int := 0; v_k date; q public.acc_vat_periods; v_small boolean; v_days int; v_due date; v_cur text;
begin
  if p_month is null then raise exception 'INVALID_INPUT'; end if;
  v_m := date_trunc('month', p_month)::date; v_end := (v_m + interval '1 month')::date - 1;
  select o.default_currency, coalesce((o.settings ->> 'vat_small_enterprise')::boolean, false), nullif(o.settings ->> 'vat_return_days', '')::int
    into v_cur, v_small, v_days from public.organizations o where o.id = v_org;
  v_led := public.acc__vat_ledger(v_org, v_m);
  begin v_sum := public.fin_vat_summary(v_m, v_end); exception when others then v_sum := null; end;   -- a head accountant who is not owner/admin
  p := public.acc__vat_live_period(v_org, v_m);
  if p.id is not null then
    select j.status into v_status from public.acc_manual_journals j where j.org_id = v_org and j.id = p.journal_id;
    select coalesce(sum(x.amount_minor), 0) into v_paid from public.acc_vat_payments x join public.acc_manual_journals j on j.org_id = x.org_id and j.id = x.journal_id
     where x.org_id = v_org and x.period_id = p.id and j.status in ('draft', 'posted');
  end if;
  -- consecutive closed credit months, ending with this one
  v_k := v_m;
  loop
    q := public.acc__vat_live_period(v_org, v_k);
    exit when q.id is null or q.due_minor >= 0 or not exists (select 1 from public.acc_manual_journals j where j.org_id = v_org and j.id = q.journal_id and j.status = 'posted');
    v_streak := v_streak + 1; v_k := (v_k - interval '1 month')::date;
  end loop;
  v_due := case when v_days is null then (v_m + interval '2 months')::date - 1 else v_end + v_days end;
  return jsonb_build_object(
    'month', v_m, 'end', v_end, 'currency', v_cur, 'ended', v_end < public.acc__local_date(v_org, now()),
    'ledgerOutputMinor', (v_led ->> 'output')::bigint, 'ledgerInputMinor', (v_led ->> 'input')::bigint,
    'ledgerDueMinor', (v_led ->> 'output')::bigint - (v_led ->> 'input')::bigint,
    'summaryDueMinor', (v_sum ->> 'dueMinor')::bigint,
    'differenceMinor', case when v_sum is null then null else ((v_led ->> 'output')::bigint - (v_led ->> 'input')::bigint) - (v_sum ->> 'dueMinor')::bigint end,
    'period', case when p.id is null then null else jsonb_build_object('id', p.id, 'journalId', p.journal_id, 'journalStatus', v_status,
                'outputMinor', p.output_minor, 'inputMinor', p.input_minor, 'dueMinor', p.due_minor, 'paidMinor', v_paid,
                'leftMinor', greatest(p.due_minor - v_paid, 0)) end,
    'creditStreak', v_streak, 'smallEnterprise', v_small,
    'refundAvailable', v_streak > case when v_small then 3 else 4 end,
    'returnDueOn', v_due, 'returnDueDays', v_days);
end $$;

-- ---------------------------------------------------------------- close, pay, opening balance

create or replace function public.acc_vat_close_month(p_month date, p_post boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.acc__journal_guard(); v_m date; v_end date; v_led jsonb; v_out bigint; v_in bigint; v_due bigint; v_lines jsonb := '[]'::jsonb;
  v_sum jsonb; v_j jsonb; v_id uuid; v_from date; v_cur text;
begin
  if p_month is null then raise exception 'INVALID_INPUT'; end if;
  v_m := date_trunc('month', p_month)::date; v_end := (v_m + interval '1 month')::date - 1;
  perform 1 from public.organizations where id = v_org for update;   -- one close at a time per company
  select nullif(o.settings ->> 'vat_from', '')::date, o.default_currency into v_from, v_cur from public.organizations o where o.id = v_org;
  if v_end >= public.acc__local_date(v_org, now()) then raise exception 'INVALID_STATE' using detail = 'a VAT month can be closed only after it has ended'; end if;
  if v_from is null or v_end < v_from then raise exception 'INVALID_STATE' using detail = 'the company was not VAT registered in that month'; end if;
  if (public.acc__vat_live_period(v_org, v_m)).id is not null then raise exception 'INVALID_STATE' using detail = 'this month is already closed (or waiting for approval)'; end if;
  v_led := public.acc__vat_ledger(v_org, v_m);
  v_out := (v_led ->> 'output')::bigint; v_in := (v_led ->> 'input')::bigint; v_due := v_out - v_in;
  if v_out = 0 and v_in = 0 then raise exception 'INVALID_STATE' using detail = 'there is no VAT in the books for that month'; end if;
  if v_out <> 0 then
    v_lines := v_lines || jsonb_build_object('accountId', public.acc__role_account(v_org, 'output_vat'),
      case when v_out > 0 then 'debitMinor' else 'creditMinor' end, abs(v_out), 'memo', 'Output VAT for ' || to_char(v_m, 'YYYY-MM'));
  end if;
  if v_in <> 0 then
    v_lines := v_lines || jsonb_build_object('accountId', public.acc__role_account(v_org, 'input_vat'),
      case when v_in > 0 then 'creditMinor' else 'debitMinor' end, abs(v_in), 'memo', 'Input VAT for ' || to_char(v_m, 'YYYY-MM'));
  end if;
  if v_due <> 0 then
    v_lines := v_lines || jsonb_build_object('accountId', public.acc__role_account(v_org, 'vat_settlement'),
      case when v_due > 0 then 'creditMinor' else 'debitMinor' end, abs(v_due),
      'memo', case when v_due > 0 then 'VAT due for ' else 'VAT credit carried forward from ' end || to_char(v_m, 'YYYY-MM'));
  end if;
  if jsonb_array_length(v_lines) < 2 then
    -- output and input are equal and only one of them is non-zero cannot happen; equal and both non-zero gives two lines
    raise exception 'INVALID_STATE' using detail = 'nothing to settle';
  end if;
  begin v_sum := public.fin_vat_summary(v_m, v_end); exception when others then v_sum := null; end;
  v_j := public.acc_save_journal(null, v_end, 'VAT return ' || to_char(v_m, 'YYYY-MM') || ': output ' || v_out || ', input ' || v_in || ', '
                                 || case when v_due >= 0 then 'due ' || v_due else 'credit ' || -v_due end, v_lines, 'manual', null, coalesce(p_post, false));
  v_id := gen_random_uuid();
  insert into public.acc_vat_periods (id, org_id, month, journal_id, output_minor, input_minor, due_minor, summary_due_minor, currency, created_by)
  values (v_id, v_org, v_m, (v_j ->> 'id')::uuid, v_out, v_in, v_due, (v_sum ->> 'dueMinor')::bigint, v_cur, auth.uid());
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.vat.closed', 'vat_period', v_id::text,
          format('VAT %s closed: output %s, input %s, %s %s (journal %s, %s)', to_char(v_m, 'YYYY-MM'), v_out, v_in,
                 case when v_due >= 0 then 'due' else 'credit' end, abs(v_due), v_j ->> 'number', v_j ->> 'status'),
          jsonb_build_object('month', v_m, 'output_minor', v_out, 'input_minor', v_in, 'due_minor', v_due, 'summary_due_minor', (v_sum ->> 'dueMinor')::bigint,
                             'journal_id', v_j ->> 'id'));
  return jsonb_build_object('periodId', v_id, 'journal', v_j, 'outputMinor', v_out, 'inputMinor', v_in, 'dueMinor', v_due);
end $$;

-- p_account_id: the ledger account the money leaves from (a bank or cash account of the chart, for example the treasury account's).
create or replace function public.acc_vat_record_payment(p_period_id uuid, p_account_id uuid, p_amount_minor bigint, p_paid_on date, p_post boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__journal_guard(); p public.acc_vat_periods; v_paid bigint; v_j jsonb; v_status text;
begin
  if p_amount_minor is null or p_amount_minor <= 0 or p_paid_on is null or p_account_id is null then raise exception 'INVALID_INPUT'; end if;
  select * into p from public.acc_vat_periods where org_id = v_org and id = p_period_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select j.status into v_status from public.acc_manual_journals j where j.org_id = v_org and j.id = p.journal_id;
  if v_status <> 'posted' or (public.acc__vat_live_period(v_org, p.month)).id is distinct from p.id then
    raise exception 'INVALID_STATE' using detail = 'the month''s closing journal must be posted first';
  end if;
  if p.due_minor <= 0 then raise exception 'INVALID_STATE' using detail = 'nothing is due for that month'; end if;
  select coalesce(sum(x.amount_minor), 0) into v_paid from public.acc_vat_payments x join public.acc_manual_journals j on j.org_id = x.org_id and j.id = x.journal_id
   where x.org_id = v_org and x.period_id = p.id and j.status in ('draft', 'posted');
  if v_paid + p_amount_minor > p.due_minor then raise exception 'OVERPAYMENT' using detail = format('%s due, %s already paid or waiting', p.due_minor, v_paid); end if;
  v_j := public.acc_save_journal(null, p_paid_on, 'VAT paid for ' || to_char(p.month, 'YYYY-MM'),
           jsonb_build_array(jsonb_build_object('accountId', public.acc__role_account(v_org, 'vat_settlement'), 'debitMinor', p_amount_minor),
                             jsonb_build_object('accountId', p_account_id, 'creditMinor', p_amount_minor)),
           'manual', p.currency, coalesce(p_post, false));
  insert into public.acc_vat_payments (org_id, period_id, journal_id, amount_minor, paid_on, created_by)
  values (v_org, p.id, (v_j ->> 'id')::uuid, p_amount_minor, p_paid_on, auth.uid());
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.vat.paid', 'vat_period', p.id::text,
          format('VAT %s: payment %s recorded (journal %s, %s)', to_char(p.month, 'YYYY-MM'), p_amount_minor, v_j ->> 'number', v_j ->> 'status'),
          jsonb_build_object('amount_minor', p_amount_minor, 'paid_on', p_paid_on, 'journal_id', v_j ->> 'id'));
  return jsonb_build_object('journal', v_j);
end $$;

-- p_amount_minor > 0: a VAT credit brought forward (receivable from the tax authority); < 0: VAT still owed. Once (while its journal is
-- a draft or posted).
create or replace function public.acc_vat_opening(p_amount_minor bigint, p_post boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__journal_guard(); v_from date; v_prev uuid; v_j jsonb; v_set uuid; v_ob uuid;
begin
  if p_amount_minor is null or p_amount_minor = 0 then raise exception 'INVALID_INPUT' using detail = 'an amount other than zero is required'; end if;
  select nullif(o.settings ->> 'vat_from', '')::date, nullif(o.settings ->> 'vat_opening_journal_id', '')::uuid into v_from, v_prev
    from public.organizations o where o.id = v_org for update;
  if v_from is null then raise exception 'INVALID_STATE' using detail = 'switch VAT on first'; end if;
  if v_prev is not null and exists (select 1 from public.acc_manual_journals j where j.org_id = v_org and j.id = v_prev and j.status in ('draft', 'posted')) then
    raise exception 'INVALID_STATE' using detail = 'the opening VAT balance is already entered: reverse it to change it';
  end if;
  v_set := public.acc__role_account(v_org, 'vat_settlement'); v_ob := public.acc__role_account(v_org, 'opening_balance');
  v_j := public.acc_save_journal(null, v_from,
           case when p_amount_minor > 0 then 'Opening VAT credit brought forward' else 'Opening VAT still owed' end,
           jsonb_build_array(jsonb_build_object('accountId', v_set, case when p_amount_minor > 0 then 'debitMinor' else 'creditMinor' end, abs(p_amount_minor)),
                             jsonb_build_object('accountId', v_ob, case when p_amount_minor > 0 then 'creditMinor' else 'debitMinor' end, abs(p_amount_minor))),
           'manual', null, coalesce(p_post, false));
  update public.organizations set settings = settings || jsonb_build_object('vat_opening_journal_id', v_j ->> 'id') where id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'accounting.vat.opening', 'organization', v_org::text,
          format('Opening VAT %s %s at %s (journal %s, %s)', case when p_amount_minor > 0 then 'credit' else 'owed' end, abs(p_amount_minor), v_from,
                 v_j ->> 'number', v_j ->> 'status'),
          jsonb_build_object('amount_minor', p_amount_minor, 'date', v_from, 'journal_id', v_j ->> 'id'));
  return jsonb_build_object('journal', v_j);
end $$;

-- ---------------------------------------------------------------- return settings (owner)

-- p_due_days: days after the month ends that the return is due (null = the end of the following month); p_small_enterprise: Law 6/2025.
create or replace function public.core_set_vat_return(p_due_days int, p_small_enterprise boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner']); v_before jsonb;
begin
  if p_due_days is not null and (p_due_days < 1 or p_due_days > 120) then raise exception 'INVALID_INPUT' using detail = 'from 1 to 120 days, or empty for the end of the following month'; end if;
  if p_small_enterprise is null then raise exception 'INVALID_INPUT'; end if;
  select jsonb_build_object('vat_return_days', o.settings -> 'vat_return_days', 'vat_small_enterprise', o.settings -> 'vat_small_enterprise')
    into v_before from public.organizations o where o.id = v_org for update;
  update public.organizations o
     set settings = (coalesce(o.settings, '{}'::jsonb) - 'vat_return_days')
                    || case when p_due_days is null then '{}'::jsonb else jsonb_build_object('vat_return_days', p_due_days) end
                    || jsonb_build_object('vat_small_enterprise', p_small_enterprise)
   where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.vat_return_changed', 'organization', v_org::text,
          format('VAT return due %s; small enterprise: %s', case when p_due_days is null then 'at the end of the following month' else p_due_days || ' days after the month' end,
                 case when p_small_enterprise then 'yes' else 'no' end),
          v_before, jsonb_build_object('vat_return_days', p_due_days, 'vat_small_enterprise', p_small_enterprise));
  return jsonb_build_object('returnDueDays', p_due_days, 'smallEnterprise', p_small_enterprise);
end $$;

revoke all on function public.acc_vat_month(date), public.acc_vat_close_month(date, boolean), public.acc_vat_record_payment(uuid, uuid, bigint, date, boolean),
  public.acc_vat_opening(bigint, boolean), public.core_set_vat_return(int, boolean) from public, anon;
grant execute on function public.acc_vat_month(date), public.acc_vat_close_month(date, boolean), public.acc_vat_record_payment(uuid, uuid, bigint, date, boolean),
  public.acc_vat_opening(bigint, boolean), public.core_set_vat_return(int, boolean) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: both tables with RLS (2); companies with a chart but no settlement role (0, unless 2872 is taken by another account); users
-- can close (true), anonymous cannot (false).
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('acc_vat_periods', 'acc_vat_payments') and relrowsecurity) as tables_with_rls,
       (select count(*) from (select distinct org_id from public.acc_accounts where deleted_at is null) o
         where not exists (select 1 from public.acc_account_roles r where r.org_id = o.org_id and r.role_key = 'vat_settlement')) as charts_missing_settlement,
       has_function_privilege('authenticated', 'public.acc_vat_close_month(date, boolean)', 'execute') as users_close,
       has_function_privilege('anon', 'public.acc_vat_close_month(date, boolean)', 'execute') as anon_close;
