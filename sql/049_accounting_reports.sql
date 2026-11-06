-- 049_accounting_reports.sql
-- Accounting phase 1, slice 5 (documentation/plans/ACCOUNTING_PLAN.md scope H): read-only reports over the journal.
--   * acc_trial_balance(from, to, currency): one row per account that has any entry up to `to`, with the opening balance (everything
--     before `from`), the period's debits and credits, and the closing balance; parents roll up their children; totals balance.
--   * acc_account_lines(account, from, to, currency): an account's lines in date order with a running balance, starting from its
--     opening balance; a group account includes all its sub-accounts. Each line names its document (source type, id, number).
-- Balances are debit minus credit (positive = debit balance). Amounts are minor units. Owners and admins only (as the ledger).
-- Nothing is written. Depends on sql/001-048. Rerun-safe. Run the whole file, then sql/tests/044_accounting_reports.sql.

begin;

create or replace function public.acc_trial_balance(p_from date, p_to date, p_currency text default null)
returns table (account_id uuid, code text, name text, name_ar text, kind text, parent_id uuid, is_leaf boolean, currency char(3),
               opening_minor bigint, debit_minor bigint, credit_minor bigint, closing_minor bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.acc__guard('read'); v_cur text;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_INPUT' using detail = 'a period with an end on or after its start is required'; end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  return query
    with recursive leaf as (
      select l.account_id as aid,
             coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.entry_date < p_from), 0)::bigint as opening,
             coalesce(sum(l.debit_minor) filter (where e.entry_date between p_from and p_to), 0)::bigint as dr,
             coalesce(sum(l.credit_minor) filter (where e.entry_date between p_from and p_to), 0)::bigint as cr
        from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
       where l.org_id = v_org and e.currency = v_cur and e.entry_date <= p_to
       group by l.account_id),
    tree as (   -- every account with each of its ancestors (itself included), to roll balances up
      select a.id as anc, a.id as des from public.acc_accounts a where a.org_id = v_org
      union all
      select t.anc, c.id from tree t join public.acc_accounts c on c.org_id = v_org and c.parent_id = t.des)
    select a.id, a.code, a.name, a.name_ar, a.kind, a.parent_id,
           not exists (select 1 from public.acc_accounts c where c.org_id = v_org and c.parent_id = a.id and c.deleted_at is null),
           v_cur::char(3),
           sum(lf.opening)::bigint, sum(lf.dr)::bigint, sum(lf.cr)::bigint, sum(lf.opening + lf.dr - lf.cr)::bigint
      from public.acc_accounts a join tree t on t.anc = a.id join leaf lf on lf.aid = t.des
     where a.org_id = v_org
     group by a.id, a.code, a.name, a.name_ar, a.kind, a.parent_id
     order by a.code;
end $$;

create or replace function public.acc_account_lines(p_account_id uuid, p_from date, p_to date, p_currency text default null)
returns table (line_id bigint, entry_id uuid, entry_number text, entry_date date, source_type text, source_id text, event text, memo text,
               account_code text, party_type text, party_id uuid, debit_minor bigint, credit_minor bigint, balance_minor bigint, is_opening boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.acc__guard('read'); v_cur text; v_open bigint; v_ids uuid[];
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.acc_accounts where org_id = v_org and id = p_account_id) then raise exception 'NOT_FOUND'; end if;
  select coalesce(upper(nullif(trim(p_currency), '')), o.default_currency) into v_cur from public.organizations o where o.id = v_org;
  with recursive sub as (select p_account_id as id union all select c.id from public.acc_accounts c join sub on c.parent_id = sub.id where c.org_id = v_org)
  select array_agg(sub.id) into v_ids from sub;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_open
    from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
   where l.org_id = v_org and e.currency = v_cur and e.entry_date < p_from and l.account_id = any(v_ids);
  return query
    select null::bigint as r_line_id, null::uuid as r_entry_id, null::text as r_entry_number, p_from as r_entry_date, null::text as r_source_type,
           null::text as r_source_id, null::text as r_event, 'Opening balance'::text as r_memo, null::text as r_code, null::text as r_party_type,
           null::uuid as r_party_id, 0::bigint as r_debit, 0::bigint as r_credit, v_open as r_balance, true as r_is_opening
    union all
    select x.line_id, x.entry_id, x.number, x.entry_date, x.source_type, x.source_id, x.event, coalesce(x.line_memo, x.entry_memo), x.code, x.party_type, x.party_id,
           x.debit_minor, x.credit_minor, (v_open + sum(x.debit_minor - x.credit_minor) over (order by x.entry_date, x.number, x.line_no))::bigint, false
      from (select l.id as line_id, e.id as entry_id, e.number, e.entry_date, e.source_type, e.source_id, e.event, l.memo as line_memo, e.memo as entry_memo,
                   a.code, l.party_type, l.party_id, l.debit_minor, l.credit_minor, l.line_no
              from public.acc_entry_lines l join public.acc_entries e on e.org_id = l.org_id and e.id = l.entry_id
              join public.acc_accounts a on a.org_id = l.org_id and a.id = l.account_id
             where l.org_id = v_org and e.currency = v_cur and e.entry_date between p_from and p_to and l.account_id = any(v_ids)) x
     order by r_is_opening desc, r_entry_date, r_entry_number, r_line_id;
end $$;

revoke all on function public.acc_trial_balance(date, date, text), public.acc_account_lines(uuid, date, date, text) from public, anon;
grant execute on function public.acc_trial_balance(date, date, text), public.acc_account_lines(uuid, date, date, text) to authenticated;

commit;

-- Verification (read-only): open to signed-in users only.
select has_function_privilege('anon', 'public.acc_trial_balance(date, date, text)', 'execute') as anon_can_read_tb,
       has_function_privilege('authenticated', 'public.acc_trial_balance(date, date, text)', 'execute') as users_can_read_tb;
