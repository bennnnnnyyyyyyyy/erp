-- sql/085_acc_statement_lines.sql
-- Financial statements (documentation/plans/FINANCIAL_STATEMENTS_PLAN.md): the income statement for a period and the balance sheet at a
-- date, from posted ledger entries, laid out by "statement line" (EAS 1 sections). Each account may carry its own statement line;
-- otherwise it uses its nearest ancestor's, otherwise a default from its code in the Egyptian unified chart and its kind.
-- Adds one nullable column to acc_accounts (RLS, isolation tests and write-through-functions already apply), one write function with
-- its audit row in the same transaction, and two read functions. Needs sql/001-084. Rerun-safe.

begin;

alter table public.acc_accounts add column if not exists statement_line text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'acc_accounts_statement_line_chk') then
    alter table public.acc_accounts add constraint acc_accounts_statement_line_chk check (statement_line is null or statement_line in (
      'revenue', 'cost_of_sales', 'other_income', 'operating_expenses', 'finance_costs', 'income_tax',
      'non_current_assets', 'inventory', 'receivables', 'cash', 'other_current_assets',
      'equity', 'non_current_liabilities', 'current_liabilities'));
  end if;
end $$;

-- The default line for an account with none of its own (and no ancestor with one), from the Egyptian unified chart's code groups.
-- Groups 25-26 (long-term loans), 37 (finance costs) and 38 (income tax) are to be confirmed with the accountant; an owner or head
-- accountant can set any account's line by hand.
create or replace function public.acc__default_statement_line(p_code text, p_kind text) returns text
language sql immutable set search_path = public as $$
  select case p_kind
    when 'revenue' then case when p_code like '42%' then 'other_income' else 'revenue' end
    when 'expense' then case when p_code like '34%' then 'cost_of_sales' when p_code like '37%' then 'finance_costs'
                             when p_code like '38%' then 'income_tax' else 'operating_expenses' end
    when 'asset' then case when left(p_code, 2) in ('11', '12', '13', '14', '15') then 'non_current_assets'
                           when p_code like '16%' then 'inventory' when p_code like '17%' then 'receivables'
                           when p_code like '19%' then 'cash' else 'other_current_assets' end
    when 'liability' then case when left(p_code, 2) in ('25', '26') then 'non_current_liabilities' else 'current_liabilities' end
    else 'equity' end
$$;
revoke all on function public.acc__default_statement_line(text, text) from public, anon, authenticated;

-- Every account of one company with the line it reports under.
create or replace function public.acc__effective_lines(p_org uuid)
returns table (account_id uuid, line text)
language sql stable security definer set search_path = public as $$
  with recursive up as (   -- each account with its ancestors, nearest first
    select a.id as aid, a.id as anc, 0 as depth from public.acc_accounts a where a.org_id = p_org
    union all
    select u.aid, p.parent_id, u.depth + 1 from up u join public.acc_accounts p on p.org_id = p_org and p.id = u.anc
     where p.parent_id is not null)
  select a.id,
         coalesce((select x.statement_line from up u join public.acc_accounts x on x.org_id = p_org and x.id = u.anc
                    where u.aid = a.id and x.statement_line is not null order by u.depth limit 1),
                  public.acc__default_statement_line(a.code, a.kind))
    from public.acc_accounts a where a.org_id = p_org
$$;
revoke all on function public.acc__effective_lines(uuid) from public, anon, authenticated;

-- Set (or clear, with null) an account's own statement line. Owner or head accountant, as for the chart.
create or replace function public.acc_set_statement_line(p_account_id uuid, p_line text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.acc__guard('chart'); a public.acc_accounts; v_line text := nullif(trim(coalesce(p_line, '')), '');
begin
  if v_line is not null and v_line not in ('revenue', 'cost_of_sales', 'other_income', 'operating_expenses', 'finance_costs', 'income_tax',
      'non_current_assets', 'inventory', 'receivables', 'cash', 'other_current_assets', 'equity', 'non_current_liabilities',
      'current_liabilities') then
    raise exception 'INVALID_INPUT' using detail = 'unknown statement line';
  end if;
  select * into a from public.acc_accounts where org_id = v_org and id = p_account_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Income statement lines only for revenue and expense accounts; balance sheet lines only for the others.
  if v_line is not null and ((a.kind in ('revenue', 'expense')) <> (v_line in ('revenue', 'cost_of_sales', 'other_income',
      'operating_expenses', 'finance_costs', 'income_tax'))) then
    raise exception 'INVALID_INPUT' using detail = 'this line belongs to the other statement';
  end if;
  if a.statement_line is not distinct from v_line then return; end if;
  update public.acc_accounts set statement_line = v_line, updated_at = now() where id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'accounting.account.statement_line', 'account', a.id::text,
          format('%s %s: %s', a.code, a.name, coalesce(v_line, 'default')),
          jsonb_build_object('statement_line', a.statement_line), jsonb_build_object('statement_line', v_line));
end $$;
revoke all on function public.acc_set_statement_line(uuid, text) from public, anon;
grant execute on function public.acc_set_statement_line(uuid, text) to authenticated;

-- Income statement for a period: one row per account with movement, amount in its natural sign (income positive, costs positive).
create or replace function public.acc_income_statement(p_from date, p_to date, p_currency text default null)
returns table (line text, account_id uuid, code text, name text, name_ar text, amount_minor bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.acc__guard('read'); v_cur text;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_INPUT' using detail = 'a period with an end on or after its start is required'; end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  return query
    select el.line, a.id, a.code, a.name, a.name_ar,
           (case when a.kind = 'revenue' then sum(l.credit_minor - l.debit_minor) else sum(l.debit_minor - l.credit_minor) end)::bigint
      from public.acc_entry_lines l
      join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
      join public.acc_accounts a on a.org_id = l.org_id and a.id = l.account_id
      join public.acc__effective_lines(v_org) el on el.account_id = a.id
     where l.org_id = v_org and e.currency = v_cur and e.entry_date between p_from and p_to and a.kind in ('revenue', 'expense')
     group by el.line, a.id, a.code, a.name, a.name_ar, a.kind
    having sum(l.debit_minor) <> 0 or sum(l.credit_minor) <> 0
     order by a.code;
end $$;

-- Balance sheet at a date: one row per account with a balance, in its natural sign (assets debit, equity and liabilities credit),
-- plus two equity rows the ledger does not hold as accounts until year-end closing exists: the profit of the fiscal year so far, and the
-- profit of earlier years not yet closed. With them, total assets = total equity + liabilities whenever the books balance.
create or replace function public.acc_balance_sheet(p_at date, p_currency text default null)
returns table (line text, account_id uuid, code text, name text, name_ar text, amount_minor bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.acc__guard('read'); v_cur text; v_fy date; v_year bigint; v_before bigint;
begin
  if p_at is null then raise exception 'INVALID_INPUT' using detail = 'a date is required'; end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  select coalesce((select f.starts_on from public.acc_fiscal_years f where f.org_id = v_org and p_at between f.starts_on and f.ends_on
                    order by f.starts_on desc limit 1), date_trunc('year', p_at)::date) into v_fy;
  select coalesce(sum(l.credit_minor - l.debit_minor) filter (where e.entry_date >= v_fy), 0),
         coalesce(sum(l.credit_minor - l.debit_minor) filter (where e.entry_date < v_fy), 0)
    into v_year, v_before
    from public.acc_entry_lines l
    join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
    join public.acc_accounts a on a.org_id = l.org_id and a.id = l.account_id
   where l.org_id = v_org and e.currency = v_cur and e.entry_date <= p_at and a.kind in ('revenue', 'expense');
  return query
    select el.line, a.id, a.code, a.name, a.name_ar,
           (case when a.kind = 'asset' then sum(l.debit_minor - l.credit_minor) else sum(l.credit_minor - l.debit_minor) end)::bigint
      from public.acc_entry_lines l
      join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
      join public.acc_accounts a on a.org_id = l.org_id and a.id = l.account_id
      join public.acc__effective_lines(v_org) el on el.account_id = a.id
     where l.org_id = v_org and e.currency = v_cur and e.entry_date <= p_at and a.kind in ('asset', 'liability', 'equity')
     group by el.line, a.id, a.code, a.name, a.name_ar, a.kind
    having sum(l.debit_minor - l.credit_minor) <> 0
    union all
    select 'equity', null::uuid, null::text, 'Profit for the year to date', 'أرباح العام حتى تاريخه', v_year where v_year <> 0
    union all
    select 'equity', null::uuid, null::text, 'Profit of earlier years not yet closed', 'أرباح سنوات سابقة لم تُقفل', v_before where v_before <> 0
     order by 3 nulls last;
end $$;

revoke all on function public.acc_income_statement(date, date, text), public.acc_balance_sheet(date, text) from public, anon;
grant execute on function public.acc_income_statement(date, date, text), public.acc_balance_sheet(date, text) to authenticated;

commit;

-- Verification (read-only).
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'acc_accounts' and column_name = 'statement_line') as has_column,
       has_function_privilege('anon', 'public.acc_balance_sheet(date, text)', 'execute') as anon_can_read,
       has_function_privilege('authenticated', 'public.acc_income_statement(date, date, text)', 'execute') as users_can_read,
       has_function_privilege('authenticated', 'public.acc_set_statement_line(uuid, text)', 'execute') as users_can_set;
