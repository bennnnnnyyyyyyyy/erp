-- sql/114_input_speed_rules.sql
-- The database side of the input and speed audit (25 Nov 2026; .temp/2026-11-25-input-speed-audit.md, Ben's answers via erp-master)
-- and of Ben's live test of the same day (phone numbers by country, item 25). The API and the screens already check these; the
-- database now refuses them too, whoever calls.
-- 1. Field rules, added NOT VALID: they check every new or changed row and leave existing rows alone (the dry run counts the rows on
--    live that would fail; such a row must be corrected the next time it is changed).
--    - phone: customers and suppliers by the shared rule (core__phone_ok, the same as packages/shared/src/phone.ts: Egyptian numbers
--      in the Egyptian shape, other countries + and the country code); shipments an Egyptian mobile;
--    - tax: the ETA profile's registration number 9 digits and activity code 4 digits; a customer's tax ID B = 9 digits, P = 14 digits
--      starting 2 or 3;
--    - lengths: contact 120, city 80, expense and payment notes 500, a stock request's reason 500, a purchase order's approval note
--      500, a task's description 4000, a supplier's invoice number 60, ETA branch address parts 100;
--    - caps: amounts at most 1e12 minor units, quantities at most 1e9.
-- 2. Dates: invoices, supplier bills, expenses, payments, manual journals, treasury transfers and VAT payments: a real day 1900-2100
--    and not after tomorrow in the company's time zone (today, plus one day of grace for time zones; Ben: refuse always, one day of
--    grace if judged necessary). A task's due time is not in the past when the task is made (5 minutes' grace).
--    Not added: the lock date on adjustments, counts, transfers, receipts and notes. Those are dated by the database at the moment
--    they are posted (now), and the lock date can never be in the future (sql/040), so they cannot land in a locked period.
-- 3. Indexes: (org_id, created_at desc) on stock requests, transfers, counts, adjustments, tasks, invoices, bills, sales and purchase
--    orders; sal_invoices (org_id, invoice_date); the stock ledger (org_id, id desc).
-- 4. Money summed in SQL: fin_open_items (what is still owed, the rules of /v1/finance/open-items) and fin_product_sales (sales by
--    product, the rules of /v1/finance/product-sales). Owners and admins (as the routes), the caller's company only.
-- 5. Report builder (sql/109 rpt__execute): the rows are taken with a plain "order by ... limit", not row_number() over every row.
--    Sales forecast (sql/110): at most the 500 subjects with the most sales ("limited": true when there were more). Not added: a time
--    limit set on the functions (a statement_timeout set inside a function does not stop the statement already running; Supabase's
--    limit for signed-in users applies, and the API turns it into a plain message).
-- 6. Item costs, the stock forecast and the expiry report as one JSON value (inv_item_costs_json, inv_forecast_json,
--    inv_expiry_report_json): a set-returning function is cut at 1,000 rows by the API layer. They call the existing functions with
--    the caller's own rights, so the same checks apply.
-- Rerun-safe. Needs sql/001-113. Then run sql/tests/111_input_speed_rules.sql and sql/tests/092_column_grants.sql. Ends with
-- read-only checks.

begin;

-- ---------------------------------------------------------------- helpers

-- An Egyptian number without +20 and without its leading 0: a mobile 1[0125] + 8 digits; Cairo/Giza 2 + 8; Alexandria 3 + 7;
-- another area code (2 digits) + 7.
create or replace function public.core__eg_national_ok(n text) returns boolean
language sql immutable as $$
  select n ~ '^1[0125][0-9]{8}$' or n ~ '^2[0-9]{8}$' or n ~ '^3[0-9]{7}$'
      or (n ~ '^[0-9]{9}$' and left(n, 2) = any (array['40', '45', '46', '47', '48', '50', '55', '57', '62', '64', '65', '66', '68', '69',
                                                         '82', '84', '86', '88', '92', '93', '95', '96', '97']))
$$;

-- The phone rule of packages/shared/src/phone.ts (checkPhone). Null or empty is "no phone" (true).
create or replace function public.core__phone_ok(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  v text := translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  n text;
begin
  v := regexp_replace(trim(v), '[[:space:]().-]', '', 'g');
  if v = '' then return true; end if;
  if v !~ '^(\+|00)?[0-9]+$' then return false; end if;
  if v like '+%' then n := substr(v, 2);
  elsif v like '00%' then n := substr(v, 3);
  else
    return public.core__eg_national_ok(case when v like '0%' then substr(v, 2) else v end);
  end if;
  if n like '20%' then return public.core__eg_national_ok(substr(n, 3)); end if;
  return n ~ '^[1-9][0-9]{7,14}$';
end $$;

-- An Egyptian mobile (shipments): 01[0125] + 8 digits, with or without +20 / 0020.
create or replace function public.core__eg_mobile_ok(p text) returns boolean
language sql immutable as $$
  select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[[:space:]().-]', '', 'g')
         ~ '^(\+20|0020|0)?1[0125][0-9]{8}$'
$$;

-- Adds a CHECK constraint NOT VALID when the table does not have it yet (rerun-safe; existing rows are not checked).
create or replace function public.core__add_check(p_table text, p_name text, p_check text) returns void
language plpgsql set search_path = public as $$
begin
  if to_regclass('public.' || p_table) is null then return; end if;
  if not exists (select 1 from pg_constraint where conname = p_name and conrelid = ('public.' || p_table)::regclass) then
    execute format('alter table public.%I add constraint %I check (%s) not valid', p_table, p_name, p_check);
  end if;
end $$;
revoke all on function public.core__add_check(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. field rules (NOT VALID)

select public.core__add_check('sal_customers', 'sal_customers_phone_chk', 'public.core__phone_ok(phone)');
select public.core__add_check('pur_suppliers', 'pur_suppliers_phone_chk', 'public.core__phone_ok(phone)');
select public.core__add_check('sal_customers', 'sal_customers_len_chk', 'coalesce(length(contact), 0) <= 120 and coalesce(length(city), 0) <= 80');
select public.core__add_check('pur_suppliers', 'pur_suppliers_len_chk', 'coalesce(length(contact), 0) <= 120 and coalesce(length(city), 0) <= 80');
select public.core__add_check('sal_shipments', 'sal_shipments_phone_chk', 'public.core__eg_mobile_ok(recipient_phone)');
select public.core__add_check('tax_profiles', 'tax_profiles_eta_numbers_chk', 'registration_number ~ ''^[0-9]{9}$'' and activity_code ~ ''^[0-9]{4}$''');
select public.core__add_check('sal_customers', 'sal_customers_tax_id_chk',
  'tax_id is null or tax_id_type is null or (tax_id_type = ''B'' and tax_id ~ ''^[0-9]{9}$'') or (tax_id_type = ''P'' and tax_id ~ ''^[23][0-9]{13}$'') or tax_id_type = ''F''');
select public.core__add_check('tax_branches', 'tax_branches_len_chk',
  'length(governate) <= 100 and length(region_city) <= 100 and length(street) <= 100 and length(building_number) <= 100');
select public.core__add_check('fin_expenses', 'fin_expenses_note_len_chk', 'coalesce(length(note), 0) <= 500');
select public.core__add_check('fin_payments', 'fin_payments_note_len_chk', 'coalesce(length(note), 0) <= 500');
select public.core__add_check('inv_requests', 'inv_requests_reason_len_chk', 'length(reason) <= 500');
select public.core__add_check('pur_orders', 'pur_orders_approval_note_len_chk', 'coalesce(length(approval_note), 0) <= 500');
select public.core__add_check('tsk_tasks', 'tsk_tasks_description_len_chk', 'length(description) <= 4000');
select public.core__add_check('pur_supplier_invoices', 'pur_supplier_invoices_number_len_chk', 'length(number) <= 60');
-- caps: amounts at most 1e12 minor units, quantities at most 1e9
select public.core__add_check('sal_order_lines', 'sal_order_lines_cap_chk', 'qty <= 1000000000 and unit_price_minor <= 1000000000000');
select public.core__add_check('pur_order_lines', 'pur_order_lines_cap_chk', 'qty <= 1000000000 and unit_cost_minor <= 1000000000000');
select public.core__add_check('sal_invoice_lines', 'sal_invoice_lines_cap_chk', 'qty <= 1000000000 and unit_price_minor <= 1000000000000');
select public.core__add_check('pur_supplier_invoice_lines', 'pur_supplier_invoice_lines_cap_chk', 'qty <= 1000000000 and unit_cost_minor <= 1000000000000');
select public.core__add_check('fin_expenses', 'fin_expenses_cap_chk', 'amount_minor <= 1000000000000');
select public.core__add_check('fin_payments', 'fin_payments_cap_chk', 'amount_minor <= 1000000000000');
select public.core__add_check('trs_transfers', 'trs_transfers_cap_chk', 'amount_minor <= 1000000000000');
select public.core__add_check('acc_vat_payments', 'acc_vat_payments_cap_chk', 'amount_minor <= 1000000000000');
select public.core__add_check('inv_request_lines', 'inv_request_lines_cap_chk', 'qty <= 1000000000');
select public.core__add_check('inv_transfer_lines', 'inv_transfer_lines_cap_chk', 'qty <= 1000000000');
select public.core__add_check('inv_adjustments', 'inv_adjustments_cap_chk', 'counted_qty <= 1000000000');
select public.core__add_check('inv_count_lines', 'inv_count_lines_cap_chk', 'counted_qty is null or counted_qty <= 1000000000');

-- ---------------------------------------------------------------- 2. dates

-- A posting date (the column named in the trigger's argument): a real day 1900-2100, and not after tomorrow in the company's time
-- zone. Checked when the row is made and when that date changes; other changes to an old row are not affected.
create or replace function public.core__posting_date_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_col text := tg_argv[0];
  v_new date := (to_jsonb(new) ->> v_col)::date;
  v_old date := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> v_col)::date end;
begin
  if v_new is null or (tg_op = 'UPDATE' and v_new is not distinct from v_old) then return new; end if;
  if v_new < date '1900-01-01' or v_new > date '2100-12-31' then
    raise exception 'INVALID_INPUT' using detail = 'the date must be between 1900 and 2100';
  end if;
  if v_new > public.acc__local_date(new.org_id, now()) + 1 then
    raise exception 'INVALID_INPUT' using detail = 'the date cannot be after today';
  end if;
  return new;
end $$;
revoke all on function public.core__posting_date_guard() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values ('sal_invoices', 'invoice_date'), ('pur_supplier_invoices', 'invoice_date'), ('fin_expenses', 'expense_date'),
                                 ('fin_payments', 'paid_on'), ('acc_manual_journals', 'entry_date'), ('trs_transfers', 'transfer_date'),
                                 ('acc_vat_payments', 'paid_on')) v(t, c)
  loop
    continue when to_regclass('public.' || r.t) is null;
    execute format('drop trigger if exists %I on public.%I', r.t || '_posting_date', r.t);
    execute format('create trigger %I before insert or update of %I on public.%I for each row execute function public.core__posting_date_guard(%L)',
                   r.t || '_posting_date', r.c, r.t, r.c);
  end loop;
end $$;

-- A new task's due time is not in the past (5 minutes' grace for clocks). Only when the task is made: the overdue reminders work on
-- tasks whose due time has since passed.
create or replace function public.tsk__due_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.due_at is not null and new.due_at < now() - interval '5 minutes' then
    raise exception 'INVALID_INPUT' using detail = 'the due time is in the past';
  end if;
  if new.due_at is not null and new.due_at > timestamptz '2100-12-31' then
    raise exception 'INVALID_INPUT' using detail = 'the date must be between 1900 and 2100';
  end if;
  return new;
end $$;
revoke all on function public.tsk__due_guard() from public, anon, authenticated;
drop trigger if exists tsk_tasks_due_guard on public.tsk_tasks;
create trigger tsk_tasks_due_guard before insert on public.tsk_tasks for each row execute function public.tsk__due_guard();

-- ---------------------------------------------------------------- 3. indexes

create index if not exists inv_requests_org_created_idx on public.inv_requests (org_id, created_at desc);
create index if not exists inv_transfers_org_created_idx on public.inv_transfers (org_id, created_at desc);
create index if not exists inv_counts_org_created_idx on public.inv_counts (org_id, created_at desc);
create index if not exists inv_adjustments_org_created_idx on public.inv_adjustments (org_id, created_at desc);
create index if not exists tsk_tasks_org_created_idx on public.tsk_tasks (org_id, created_at desc);
create index if not exists sal_invoices_org_created_idx on public.sal_invoices (org_id, created_at desc);
create index if not exists pur_supplier_invoices_org_created_idx on public.pur_supplier_invoices (org_id, created_at desc);
create index if not exists sal_orders_org_created_idx on public.sal_orders (org_id, created_at desc);
create index if not exists pur_orders_org_created_idx on public.pur_orders (org_id, created_at desc);
create index if not exists sal_invoices_org_date_idx on public.sal_invoices (org_id, invoice_date);
create index if not exists inv_stock_moves_org_id_idx on public.inv_stock_moves (org_id, id desc);

-- ---------------------------------------------------------------- 4. money summed in SQL

-- What is still owed (the rules of GET /v1/finance/open-items): direction 'in' = issued customer invoices, gross plus or minus
-- approved credit and debit notes, minus recorded incoming payments; 'out' = supplier bills (gross plus or minus approved supplier
-- notes) and recorded expenses, minus recorded outgoing payments. Only items with something left. The API adds days overdue and
-- the age band. Owners and admins (the route's finance.reports.view; payments are theirs to read), the caller's company only.
create or replace function public.fin_open_items(p_direction text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
begin
  if p_direction is null or p_direction not in ('in', 'out') then raise exception 'INVALID_INPUT' using detail = 'in or out'; end if;
  return coalesce((
    with paid as (
      select coalesce(p.customer_invoice_id, p.supplier_invoice_id, p.expense_id) as k, sum(p.amount_minor) as amt
        from public.fin_payments p
       where p.org_id = v_org and p.status = 'recorded' and p.direction = p_direction
       group by 1
    ), items as (
      select 'customer_invoice' as kind, i.id, i.number, i.customer_id as party_id, i.currency::text as currency, i.due_date,
             coalesce(i.gross_minor, 0) + coalesce((select sum(case when n.kind = 'credit' then -n.total_minor else n.total_minor end)
                                                    from public.sal_notes n where n.org_id = i.org_id and n.invoice_id = i.id and n.status = 'approved'), 0) as total,
             null::text as detail
        from public.sal_invoices i where p_direction = 'in' and i.org_id = v_org and i.status = 'issued'
      union all
      select 'supplier_invoice', b.id, b.number, b.supplier_id, b.currency::text, b.due_date,
             coalesce(b.gross_minor, 0) + coalesce((select sum(case when n.kind = 'credit' then -n.gross_minor else n.gross_minor end)
                                                    from public.pur_notes n where n.org_id = b.org_id and n.bill_id = b.id and n.status = 'approved'), 0),
             null
        from public.pur_supplier_invoices b where p_direction = 'out' and b.org_id = v_org
      union all
      select 'expense', e.id, e.number, e.supplier_id, e.currency::text, e.expense_date, e.amount_minor,
             nullif(concat_ws(' · ', nullif(c.name, ''), nullif(e.note, '')), '')
        from public.fin_expenses e left join public.fin_categories c on c.org_id = e.org_id and c.id = e.category_id
       where p_direction = 'out' and e.org_id = v_org and e.status = 'recorded'
    )
    select jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'number', x.number, 'partyId', x.party_id, 'currency', x.currency,
                                        'totalMinor', x.total, 'paidMinor', coalesce(pd.amt, 0), 'dueDate', x.due_date, 'detail', x.detail)
                     order by x.number desc)
      from items x left join paid pd on pd.k = x.id
     where x.total - coalesce(pd.amt, 0) > 0), '[]'::jsonb);
end $$;
revoke all on function public.fin_open_items(text) from public, anon;
grant execute on function public.fin_open_items(text) to authenticated;

-- Sales by product (the rules of GET /v1/finance/product-sales): issued invoices dated in the last p_days days with today (company
-- time zone), revenue = round(qty x unit price) before VAT, credit notes not taken off, every currency together, by item.
create or replace function public.fin_product_sales(p_days int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org   uuid := public.require_org_role(array['owner', 'admin']);
  v_since date;
begin
  if p_days is null or p_days not between 1 and 3660 then raise exception 'INVALID_INPUT' using detail = '1 to 3660 days'; end if;
  -- the company's today (acc__local_date is closed to signed-in users; this function runs with their rights)
  v_since := (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = v_org), 'UTC'))::date - (p_days - 1);
  return (
    with r as (
      select ol.item_id, sum(l.qty) as qty, sum(round(l.qty * l.unit_price_minor))::bigint as rev
        from public.sal_invoices i
        join public.sal_invoice_lines l on l.org_id = i.org_id and l.invoice_id = i.id
        join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
       where i.org_id = v_org and i.status = 'issued' and i.invoice_date >= v_since
       group by ol.item_id
    )
    select jsonb_build_object('since', v_since, 'totalMinor', coalesce((select sum(rev) from r), 0),
                              'rows', coalesce(jsonb_agg(jsonb_build_object('itemId', r.item_id, 'qty', round(r.qty, 3), 'revenueMinor', r.rev)
                                                         order by r.rev desc, r.item_id), '[]'::jsonb))
      from r);
end $$;
revoke all on function public.fin_product_sales(int) from public, anon;
grant execute on function public.fin_product_sales(int) to authenticated;

-- ---------------------------------------------------------------- 6. one JSON value instead of rows (no 1,000-row cut)

create or replace function public.inv_item_costs_json() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sku), '[]'::jsonb) from public.inv_item_costs() x
$$;
revoke all on function public.inv_item_costs_json() from public, anon;
grant execute on function public.inv_item_costs_json() to authenticated;

create or replace function public.inv_forecast_json() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.days_of_cover nulls last, x.sku), '[]'::jsonb) from public.inv_forecast() x
$$;
revoke all on function public.inv_forecast_json() from public, anon;
grant execute on function public.inv_forecast_json() to authenticated;

create or replace function public.inv_expiry_report_json(p_days int default 90) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.expiry_date, x.sku), '[]'::jsonb) from public.inv_expiry_report(p_days) x
$$;
revoke all on function public.inv_expiry_report_json(int) from public, anon;
grant execute on function public.inv_expiry_report_json(int) to authenticated;

-- ---------------------------------------------------------------- 5. report builder and forecast speed
-- sql/109 rpt__execute, one change: the rows are taken with "order by ... limit" (no row_number() over every row).

create or replace function public.rpt__execute(p_def jsonb, p_src jsonb, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz       text := coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC');
  v_groups   text[] := public.rpt__strings(p_def -> 'groupBy');
  v_grouped  boolean := cardinality(public.rpt__strings(p_def -> 'groupBy')) > 0;
  v_cols     text[] := public.rpt__strings(p_def -> 'columns');
  v_totals   jsonb := coalesce(nullif(p_def -> 'totals', 'null'), '[]');
  v_filters  jsonb := coalesce(nullif(p_def -> 'filters', 'null'), '[]');
  v_limit    int := coalesce((p_def ->> 'limit')::int, 5000);
  v_cur      text := p_src ->> 'currency';
  v_from     date := (p_def -> 'period' ->> 'from')::date;
  v_to       date := (p_def -> 'period' ->> 'to')::date;
  v_where    text := p_src ->> 'where';
  v_select   text[] := '{}';
  v_names    text[] := '{}';
  v_keys     text[] := '{}';
  v_meta     jsonb := '[]';
  v_order    text[] := '{}';
  v_tot_sel  text[] := '{}';
  v_money    boolean;
  v_money_t  boolean;
  v_sql      text;
  v_rows     jsonb;
  v_sum      jsonb := '[]';
  v_trunc    boolean := false;
  e          jsonb;
  k          text;
  x          text;
  i          int := 0;
begin
  if v_limit > 5000 then v_limit := 5000; end if;
  -- the period and the filters
  if v_from is not null then
    v_where := v_where || format(' and (%s) between $4 and $5', public.rpt__col_expr(p_src, p_src ->> 'period'));
  end if;
  for e in select f from jsonb_array_elements(v_filters) f loop
    v_where := v_where || ' and ' || public.rpt__filter_sql(p_src, e, i);
    i := i + 1;
  end loop;

  -- money totals are always split by currency
  v_money_t := v_cur is not null and exists (select 1 from jsonb_array_elements(v_totals) t
                                               where public.rpt__col_type(p_src, t ->> 'column') = 'money' and t ->> 'fn' <> 'count');
  if v_grouped then
    foreach k in array v_groups loop
      v_select := v_select || format('(%s) as c%s', public.rpt__col_expr(p_src, k), cardinality(v_select));
      v_keys := v_keys || k;
      v_meta := v_meta || jsonb_build_object('key', k, 'type', public.rpt__col_type(p_src, k));
    end loop;
    if v_money_t then
      v_select := v_select || format('(%s) as c%s', v_cur, cardinality(v_select));
      v_keys := v_keys || 'currency'::text;
      v_meta := v_meta || jsonb_build_object('key', 'currency', 'type', 'currency');
    end if;
    for e in select t from jsonb_array_elements(v_totals) t loop
      x := format('%s(%s)', e ->> 'fn', public.rpt__col_expr(p_src, e ->> 'column'));
      if e ->> 'fn' = 'avg' then x := format('round(%s, 2)', x); end if;
      v_select := v_select || format('%s as c%s', x, cardinality(v_select));
      v_keys := v_keys || ((e ->> 'fn') || '_' || (e ->> 'column'));
      v_meta := v_meta || jsonb_build_object('key', (e ->> 'fn') || '_' || (e ->> 'column'),
                                             'type', case when e ->> 'fn' = 'count' then 'number' else public.rpt__col_type(p_src, e ->> 'column') end);
    end loop;
  else
    foreach k in array v_cols loop
      v_select := v_select || format('(%s) as c%s', public.rpt__col_expr(p_src, k), cardinality(v_select));
      v_keys := v_keys || k;
      v_meta := v_meta || jsonb_build_object('key', k, 'type', public.rpt__col_type(p_src, k));
    end loop;
    v_money := v_cur is not null and exists (select 1 from unnest(v_cols) c where public.rpt__col_type(p_src, c) = 'money');
    if v_money then
      v_select := v_select || format('(%s) as c%s', v_cur, cardinality(v_select));
      v_keys := v_keys || 'currency'::text;
      v_meta := v_meta || jsonb_build_object('key', 'currency', 'type', 'currency');
    end if;
  end if;

  -- The rows. The inner query names its outputs c0, c1, ...; the sort refers to those names, so a grouped report can sort by a total.
  -- Sort: the chosen order; else (not grouped) newest first by the period column; else the first column.
  select array_agg(format('c%s', n - 1) order by n) into v_names from generate_series(1, cardinality(v_select)) n;
  if v_grouped then
    for e in select s from jsonb_array_elements(coalesce(nullif(p_def -> 'sort', 'null'), '[]')) s loop
      v_order := v_order || format('c%s %s nulls last', array_position(v_keys, e ->> 'column') - 1, case when e ->> 'dir' = 'desc' then 'desc' else 'asc' end);
    end loop;
    if cardinality(v_order) = 0 then v_order := array['c0 asc nulls last']; end if;
    v_sql := format(
      'select coalesce(jsonb_agg(jsonb_build_array(%1$s) order by %2$s), ''[]''::jsonb) from (select * from (select %3$s from %4$s where %5$s group by %6$s) q order by %2$s limit %7$s) s',
      array_to_string(v_names, ', '), array_to_string(v_order, ', '), array_to_string(v_select, ', '), p_src ->> 'from', v_where,
      (select string_agg(n::text, ', ') from generate_series(1, cardinality(v_groups) + case when v_money_t then 1 else 0 end) n),
      v_limit + 1);
  else
    for e in select s from jsonb_array_elements(coalesce(nullif(p_def -> 'sort', 'null'), '[]')) s loop
      v_order := v_order || format('c%s %s nulls last', array_position(v_keys, e ->> 'column') - 1, case when e ->> 'dir' = 'desc' then 'desc' else 'asc' end);
    end loop;
    if cardinality(v_order) = 0 then
      if p_src ->> 'period' is not null then
        v_select := v_select || format('(%s) as _p', public.rpt__col_expr(p_src, p_src ->> 'period'));
        v_order := array['_p desc nulls last'];
      else
        v_order := array['c0 asc nulls last'];
      end if;
    end if;
    v_sql := format(
      'select coalesce(jsonb_agg(jsonb_build_array(%1$s) order by %2$s), ''[]''::jsonb) from (select * from (select %3$s from %4$s where %5$s) q order by %2$s limit %6$s) s',
      array_to_string(v_names, ', '), array_to_string(v_order, ', '), array_to_string(v_select, ', '), p_src ->> 'from', v_where, v_limit + 1);
  end if;
  execute v_sql into v_rows using p_org, v_tz, v_filters, v_from, v_to;
  if jsonb_array_length(v_rows) > v_limit then
    v_trunc := true;
    v_rows := v_rows - v_limit;
  end if;

  -- totals over every matching row (not only the rows shown), one line per currency when a money total is asked for
  if jsonb_array_length(v_totals) > 0 then
    for e in select t from jsonb_array_elements(v_totals) t loop
      x := format('%s(%s)', e ->> 'fn', public.rpt__col_expr(p_src, e ->> 'column'));
      if e ->> 'fn' = 'avg' then x := format('round(%s, 2)', x); end if;
      v_tot_sel := v_tot_sel || x;
    end loop;
    v_sql := format(
      'select coalesce(jsonb_agg(jsonb_build_object(''currency'', cur, ''values'', vals) order by cur nulls first), ''[]''::jsonb) from (select %s as cur, jsonb_build_array(%s) as vals from %s where %s group by 1) s',
      case when v_money_t then v_cur else 'null::text' end, array_to_string(v_tot_sel, ', '), p_src ->> 'from', v_where);
    execute v_sql into v_sum using p_org, v_tz, v_filters, v_from, v_to;
  end if;

  return jsonb_build_object(
    'columns', v_meta,
    'rows', v_rows,
    'totals', (select coalesce(jsonb_agg(jsonb_build_object('key', (t ->> 'fn') || '_' || (t ->> 'column'), 'fn', t ->> 'fn', 'column', t ->> 'column',
                                                             'type', case when t ->> 'fn' = 'count' then 'number' else public.rpt__col_type(p_src, t ->> 'column') end)
                                          order by n), '[]'::jsonb)
                 from jsonb_array_elements(v_totals) with ordinality z(t, n)),
    'totalRows', v_sum,
    'truncated', v_trunc);
end $$;
revoke all on function public.rpt__execute(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.rpt__execute(jsonb, jsonb, uuid) from public, anon, authenticated;

-- sql/110 rpt_sales_forecast, one change: at most 500 subjects (the most sales first), with "limited" when there were more.

create or replace function public.rpt_sales_forecast(p_by text default 'item', p_horizon int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c       record;
  v_tz    text;
  v_today date;
begin
  select * into c from public.rpt__caller();
  if p_by is null or p_by not in ('item', 'customer') then raise exception 'INVALID_INPUT' using detail = 'by item or by customer'; end if;
  if p_horizon is null or p_horizon not in (30, 60, 90) then raise exception 'INVALID_INPUT' using detail = 'the next 30, 60 or 90 days'; end if;
  if not exists (select 1 from public.org_modules m where m.org_id = c.org and m.module_key = 'sales' and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = c.org), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  return (
    with lines as (
      -- issued invoices in the last 90 days
      select case when p_by = 'item' then ol.item_id else i.customer_id end as subj, i.currency::text as cur, i.invoice_date as d,
             i.id as inv, l.qty, l.net_minor
        from public.sal_invoice_lines l
        join public.sal_invoices i on i.org_id = l.org_id and i.id = l.invoice_id
        join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
       where l.org_id = c.org and i.status = 'issued' and i.invoice_date > v_today - 90 and i.invoice_date <= v_today
      union all
      -- approved credit notes decided in the last 90 days: taken off
      select case when p_by = 'item' then ol.item_id else i.customer_id end, n.currency::text, (n.decided_at at time zone v_tz)::date,
             null::uuid, -nl.qty, -nl.net_minor
        from public.sal_note_lines nl
        join public.sal_notes n on n.org_id = nl.org_id and n.id = nl.note_id
        join public.sal_invoice_lines l on l.org_id = nl.org_id and l.id = nl.invoice_line_id
        join public.sal_invoices i on i.org_id = l.org_id and i.id = l.invoice_id
        join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id
       where nl.org_id = c.org and n.kind = 'credit' and n.status = 'approved' and n.decided_at is not null
         and (n.decided_at at time zone v_tz)::date > v_today - 90 and (n.decided_at at time zone v_tz)::date <= v_today
    ), banded as (
      select l.*, case when l.d > v_today - 30 then 1 when l.d > v_today - 60 then 2 else 3 end as band from lines l
    ), per_subject as (
      select b.subj,
             sum(b.qty) filter (where b.band = 1) as q1, sum(b.qty) filter (where b.band = 2) as q2, sum(b.qty) filter (where b.band = 3) as q3,
             count(distinct b.inv) as invoices,
             v_today - min(b.d) filter (where b.inv is not null) as history_days
        from banded b group by b.subj
      having count(b.inv) > 0
    ), per_cur as (
      select b.subj, b.cur,
             coalesce(sum(b.net_minor) filter (where b.band = 1), 0) as v1, coalesce(sum(b.net_minor) filter (where b.band = 2), 0) as v2,
             coalesce(sum(b.net_minor) filter (where b.band = 3), 0) as v3, coalesce(sum(b.net_minor), 0) as vt
        from banded b group by b.subj, b.cur
    ), main_cur as (
      select distinct on (pc.subj) pc.subj, pc.v1, pc.v3 from per_cur pc order by pc.subj, pc.vt desc, pc.cur
    ), calc as (
      select s.subj, coalesce(s.q1, 0) as q1, coalesce(s.q2, 0) as q2, coalesce(s.q3, 0) as q3, s.invoices, coalesce(s.history_days, 0) as history_days,
             (0.5 * coalesce(s.q1, 0) + 0.3 * coalesce(s.q2, 0) + 0.2 * coalesce(s.q3, 0)) / 30.0 as qrate,
             case when p_by = 'item' then coalesce(s.q1, 0) else mc.v1 end as t1,
             case when p_by = 'item' then coalesce(s.q3, 0) else mc.v3 end as t3
        from per_subject s left join main_cur mc on mc.subj = s.subj
    ), rows as (
      select k.*,
             case when k.t1 > 0 and k.t3 <= 0 then 'up'
                  when k.t1 > k.t3 * 1.1 then 'up'
                  when k.t1 < k.t3 * 0.9 then 'down'
                  else 'flat' end as trend,
             case when k.invoices >= 8 and k.history_days >= 60 then 'good' else 'thin' end as confidence
        from calc k
       -- sql/114: at most the 500 subjects with the most sales
       order by (select max(pc.vt) from per_cur pc where pc.subj = k.subj) desc nulls last, k.subj
       limit 500
    )
    select jsonb_build_object(
      'asOf', v_today, 'by', p_by, 'horizon', p_horizon, 'limited', (select count(*) from calc) > 500,
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', r.subj,
        'code', case when p_by = 'item' then it.sku else cu.code end,
        'name', case when p_by = 'item' then it.name else cu.name end,
        'nameAr', case when p_by = 'item' then it.name_ar end,
        'uom', case when p_by = 'item' then it.uom end,
        'qtyLast30', case when p_by = 'item' then r.q1 end,
        'qtyPrev30', case when p_by = 'item' then r.q2 end,
        'qtyOldest30', case when p_by = 'item' then r.q3 end,
        'dailyQty', case when p_by = 'item' then round(r.qrate, 4) end,
        'forecastQty', case when p_by = 'item' then round(greatest(r.qrate, 0) * p_horizon, 3) end,
        'invoices', r.invoices, 'historyDays', r.history_days, 'trend', r.trend, 'confidence', r.confidence,
        'values', (select jsonb_agg(jsonb_build_object(
                            'currency', pc.cur, 'last30Minor', pc.v1, 'prev30Minor', pc.v2, 'oldest30Minor', pc.v3,
                            'dailyMinor', round((0.5 * pc.v1 + 0.3 * pc.v2 + 0.2 * pc.v3) / 30.0),
                            'forecastMinor', greatest(round((0.5 * pc.v1 + 0.3 * pc.v2 + 0.2 * pc.v3) / 30.0 * p_horizon), 0))
                          order by pc.vt desc, pc.cur)
                     from per_cur pc where pc.subj = r.subj))
        order by (select max(pc.vt) from per_cur pc where pc.subj = r.subj) desc nulls last, r.subj), '[]'::jsonb))
      from rows r
      left join public.inv_items it on p_by = 'item' and it.org_id = c.org and it.id = r.subj
      left join public.sal_customers cu on p_by = 'customer' and cu.org_id = c.org and cu.id = r.subj
  );
end $$;
revoke all on function public.rpt_sales_forecast(text, int) from public, anon;
grant execute on function public.rpt_sales_forecast(text, int) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: true, false, true, true, true, 7, true, true, true.
select public.core__phone_ok('+201001234567') as eg_mobile_ok, public.core__phone_ok('+2015556487744') as ben_case_ok,
       public.core__phone_ok('+971 4 555 0102') as uae_ok,
       exists (select 1 from pg_constraint where conname = 'sal_customers_phone_chk' and not convalidated) as phone_rule_not_valid,
       exists (select 1 from pg_trigger where tgname = 'tsk_tasks_due_guard') as task_due_rule,
       (select count(*) from pg_trigger where tgname like '%\_posting_date' and not tgisinternal) as posting_date_rules,
       to_regclass('public.sal_invoices_org_date_idx') is not null as invoice_date_index,
       has_function_privilege('authenticated', 'public.fin_open_items(text)', 'execute') as users_open_items,
       has_function_privilege('authenticated', 'public.inv_item_costs_json()', 'execute') as users_item_costs_json;
