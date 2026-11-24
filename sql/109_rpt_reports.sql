-- sql/109_rpt_reports.sql
-- Reports & Insights, step 2 (documentation/plans/REPORTS_INSIGHTS_PLAN.md, approved by Ben 24 Nov 2026): the report builder.
-- 1. rpt__catalog(): the fixed list of data sources. Each source is one fixed query written here (tables, joins, the company filter
--    `org_id = $1`), with its columns (key, type, SQL expression), the module it needs and the roles that may use it. The roles copy
--    what each table allows today (row level security): sales, orders, supplier bills and stock for every member; expenses, payments,
--    money owed and the ledger for owners and admins only. Costs the database hides today (item average cost, cost on stock moves)
--    are in no source.
-- 2. rpt__check(): checks a report definition (source, columns, filters, period, group by, totals, sort, limit, chart) against that
--    list. Anything not on it is refused with INVALID_INPUT. The browser never sends SQL.
-- 3. rpt_run(definition): runs it for the caller's company. Column and table names come only from the catalogue; operators and
--    functions only from fixed lists; every filter value and the period are passed as parameters ($3, $4, $5), never put into the SQL
--    text. At most 5,000 rows (`truncated` above that). Money totals are one line per currency (never added across currencies).
--    Time limit: Supabase's statement timeout for signed-in users (a timeout set inside this function would not stop it).
-- 4. rpt_sources(): the sources the caller may use (without the SQL), for the builder.
-- 5. rpt_reports: saved reports, `company` (owners and admins save them) or `private` (members too, only the owner sees it).
--    rpt_save_report and rpt_delete_report (soft delete), audited before and after, in the same transaction.
-- 6. "All apps on" for new companies now includes `reports`.
-- Rerun-safe. Needs sql/001-108. Then run sql/tests/106_rpt_reports.sql and sql/tests/092_column_grants.sql. Ends with read-only checks.

begin;

-- ---------------------------------------------------------------- 1. the fixed list of sources

create or replace function public.rpt__catalog() returns jsonb
language sql immutable set search_path = public as $fn$
select $j$
{
  "sales_lines": {
    "module": "sales", "roles": ["owner", "admin", "member", "viewer"],
    "from": "public.sal_invoice_lines l join public.sal_invoices i on i.org_id = l.org_id and i.id = l.invoice_id join public.sal_order_lines ol on ol.org_id = l.org_id and ol.id = l.order_line_id join public.sal_orders o on o.org_id = i.org_id and o.id = i.order_id join public.sal_customers c on c.org_id = i.org_id and c.id = i.customer_id left join public.sal_customer_groups cg on cg.org_id = c.org_id and cg.id = c.customer_group_id join public.inv_items it on it.org_id = ol.org_id and it.id = ol.item_id left join public.inv_item_groups ig on ig.org_id = it.org_id and ig.id = it.group_id left join public.inv_warehouses w on w.org_id = o.org_id and w.id = o.warehouse_id left join public.core_branches b on b.org_id = w.org_id and b.id = w.branch_id",
    "where": "l.org_id = $1 and i.status = 'issued'",
    "period": "invoice_date", "periodRequired": true, "currency": "i.currency::text",
    "columns": [
      {"key": "invoice_date", "type": "date", "expr": "i.invoice_date"},
      {"key": "invoice_number", "type": "text", "expr": "i.number"},
      {"key": "customer", "type": "text", "expr": "c.name"},
      {"key": "customer_code", "type": "text", "expr": "c.code"},
      {"key": "customer_group", "type": "text", "expr": "cg.name"},
      {"key": "item", "type": "text", "expr": "it.name"},
      {"key": "sku", "type": "text", "expr": "it.sku"},
      {"key": "item_group", "type": "text", "expr": "ig.name"},
      {"key": "warehouse", "type": "text", "expr": "w.name"},
      {"key": "branch", "type": "text", "expr": "b.name"},
      {"key": "qty", "type": "number", "expr": "l.qty"},
      {"key": "unit_price", "type": "money", "expr": "l.unit_price_minor"},
      {"key": "net", "type": "money", "expr": "l.net_minor"},
      {"key": "vat", "type": "money", "expr": "l.tax_minor"},
      {"key": "total", "type": "money", "expr": "(l.net_minor + l.tax_minor)"}
    ]
  },
  "sales_orders": {
    "module": "sales", "roles": ["owner", "admin", "member", "viewer"],
    "from": "public.sal_orders o join public.sal_customers c on c.org_id = o.org_id and c.id = o.customer_id left join public.sal_customer_groups cg on cg.org_id = c.org_id and cg.id = c.customer_group_id left join public.inv_warehouses w on w.org_id = o.org_id and w.id = o.warehouse_id left join public.core_branches b on b.org_id = w.org_id and b.id = w.branch_id",
    "where": "o.org_id = $1 and o.deleted_at is null",
    "period": "order_date", "periodRequired": true, "currency": "o.currency::text",
    "columns": [
      {"key": "order_date", "type": "date", "expr": "(o.created_at at time zone $2)::date"},
      {"key": "order_number", "type": "text", "expr": "o.number"},
      {"key": "status", "type": "text", "expr": "o.status"},
      {"key": "customer", "type": "text", "expr": "c.name"},
      {"key": "customer_group", "type": "text", "expr": "cg.name"},
      {"key": "warehouse", "type": "text", "expr": "w.name"},
      {"key": "branch", "type": "text", "expr": "b.name"},
      {"key": "lines", "type": "number", "expr": "(select count(*) from public.sal_order_lines x where x.org_id = o.org_id and x.order_id = o.id)"},
      {"key": "total", "type": "money", "expr": "(select coalesce(sum(round(x.qty * x.unit_price_minor)), 0)::bigint from public.sal_order_lines x where x.org_id = o.org_id and x.order_id = o.id)"}
    ]
  },
  "purchase_lines": {
    "module": "purchasing", "roles": ["owner", "admin", "member", "viewer"],
    "from": "public.pur_supplier_invoice_lines l join public.pur_supplier_invoices i on i.org_id = l.org_id and i.id = l.invoice_id join public.pur_suppliers s on s.org_id = i.org_id and s.id = i.supplier_id join public.pur_order_lines pl on pl.org_id = l.org_id and pl.id = l.order_line_id join public.inv_items it on it.org_id = pl.org_id and it.id = pl.item_id left join public.inv_item_groups ig on ig.org_id = it.org_id and ig.id = it.group_id",
    "where": "l.org_id = $1",
    "period": "bill_date", "periodRequired": true, "currency": "i.currency::text",
    "columns": [
      {"key": "bill_date", "type": "date", "expr": "i.invoice_date"},
      {"key": "bill_number", "type": "text", "expr": "i.number"},
      {"key": "due_date", "type": "date", "expr": "i.due_date"},
      {"key": "supplier", "type": "text", "expr": "s.name"},
      {"key": "supplier_code", "type": "text", "expr": "s.code"},
      {"key": "item", "type": "text", "expr": "it.name"},
      {"key": "sku", "type": "text", "expr": "it.sku"},
      {"key": "item_group", "type": "text", "expr": "ig.name"},
      {"key": "qty", "type": "number", "expr": "l.qty"},
      {"key": "unit_cost", "type": "money", "expr": "l.unit_cost_minor"},
      {"key": "net", "type": "money", "expr": "l.net_minor"},
      {"key": "vat", "type": "money", "expr": "l.tax_minor"},
      {"key": "total", "type": "money", "expr": "(l.net_minor + l.tax_minor)"}
    ]
  },
  "stock_on_hand": {
    "module": "inventory", "roles": ["owner", "admin", "member", "viewer"],
    "from": "public.inv_stock_balances sb join public.inv_items it on it.org_id = sb.org_id and it.id = sb.item_id join public.inv_warehouses w on w.org_id = sb.org_id and w.id = sb.warehouse_id left join public.inv_item_groups ig on ig.org_id = it.org_id and ig.id = it.group_id left join public.core_branches b on b.org_id = w.org_id and b.id = w.branch_id",
    "where": "sb.org_id = $1 and it.deleted_at is null",
    "period": null, "periodRequired": false, "currency": null,
    "columns": [
      {"key": "item", "type": "text", "expr": "it.name"},
      {"key": "sku", "type": "text", "expr": "it.sku"},
      {"key": "item_group", "type": "text", "expr": "ig.name"},
      {"key": "warehouse", "type": "text", "expr": "w.name"},
      {"key": "branch", "type": "text", "expr": "b.name"},
      {"key": "uom", "type": "text", "expr": "it.uom"},
      {"key": "on_hand", "type": "number", "expr": "sb.on_hand"},
      {"key": "reserved", "type": "number", "expr": "sb.reserved"},
      {"key": "available", "type": "number", "expr": "(sb.on_hand - sb.reserved)"},
      {"key": "reorder_level", "type": "number", "expr": "it.reorder_level"}
    ]
  },
  "stock_moves": {
    "module": "inventory", "roles": ["owner", "admin", "member", "viewer"],
    "from": "public.inv_stock_moves m join public.inv_items it on it.org_id = m.org_id and it.id = m.item_id join public.inv_warehouses w on w.org_id = m.org_id and w.id = m.warehouse_id left join public.inv_item_groups ig on ig.org_id = it.org_id and ig.id = it.group_id left join public.core_branches b on b.org_id = w.org_id and b.id = w.branch_id",
    "where": "m.org_id = $1",
    "period": "move_date", "periodRequired": true, "currency": null,
    "columns": [
      {"key": "move_date", "type": "date", "expr": "(m.posted_at at time zone $2)::date"},
      {"key": "item", "type": "text", "expr": "it.name"},
      {"key": "sku", "type": "text", "expr": "it.sku"},
      {"key": "item_group", "type": "text", "expr": "ig.name"},
      {"key": "warehouse", "type": "text", "expr": "w.name"},
      {"key": "branch", "type": "text", "expr": "b.name"},
      {"key": "kind", "type": "text", "expr": "m.kind"},
      {"key": "qty", "type": "number", "expr": "m.qty"},
      {"key": "reference", "type": "text", "expr": "m.ref"}
    ]
  },
  "receivables": {
    "module": "finance", "roles": ["owner", "admin"],
    "from": "public.sal_invoices i join public.sal_customers c on c.org_id = i.org_id and c.id = i.customer_id left join public.sal_customer_groups cg on cg.org_id = c.org_id and cg.id = c.customer_group_id",
    "where": "i.org_id = $1 and i.status = 'issued' and public.sal__invoice_owed(i.org_id, i.id) > 0",
    "period": "invoice_date", "periodRequired": false, "currency": "i.currency::text",
    "columns": [
      {"key": "customer", "type": "text", "expr": "c.name"},
      {"key": "customer_code", "type": "text", "expr": "c.code"},
      {"key": "customer_group", "type": "text", "expr": "cg.name"},
      {"key": "invoice_number", "type": "text", "expr": "i.number"},
      {"key": "invoice_date", "type": "date", "expr": "i.invoice_date"},
      {"key": "due_date", "type": "date", "expr": "i.due_date"},
      {"key": "days_overdue", "type": "number", "expr": "greatest(0, (now() at time zone $2)::date - i.due_date)"},
      {"key": "age_band", "type": "text", "expr": "(case when (now() at time zone $2)::date - i.due_date <= 30 then '0-30' when (now() at time zone $2)::date - i.due_date <= 60 then '31-60' when (now() at time zone $2)::date - i.due_date <= 90 then '61-90' else '90+' end)"},
      {"key": "invoice_total", "type": "money", "expr": "i.gross_minor"},
      {"key": "owed", "type": "money", "expr": "public.sal__invoice_owed(i.org_id, i.id)"}
    ]
  },
  "expenses": {
    "module": "finance", "roles": ["owner", "admin"],
    "from": "public.fin_expenses e join public.fin_categories fc on fc.org_id = e.org_id and fc.id = e.category_id left join public.pur_suppliers s on s.org_id = e.org_id and s.id = e.supplier_id",
    "where": "e.org_id = $1 and e.status = 'recorded'",
    "period": "expense_date", "periodRequired": true, "currency": "e.currency::text",
    "columns": [
      {"key": "expense_date", "type": "date", "expr": "e.expense_date"},
      {"key": "expense_number", "type": "text", "expr": "e.number"},
      {"key": "category", "type": "text", "expr": "fc.name"},
      {"key": "supplier", "type": "text", "expr": "s.name"},
      {"key": "net", "type": "money", "expr": "e.net_minor"},
      {"key": "vat", "type": "money", "expr": "e.tax_minor"},
      {"key": "amount", "type": "money", "expr": "e.amount_minor"},
      {"key": "note", "type": "text", "expr": "e.note"}
    ]
  },
  "payments": {
    "module": "finance", "roles": ["owner", "admin"],
    "from": "public.fin_payments p left join public.sal_invoices si on si.org_id = p.org_id and si.id = p.customer_invoice_id left join public.sal_customers c on c.org_id = si.org_id and c.id = si.customer_id left join public.pur_supplier_invoices pi on pi.org_id = p.org_id and pi.id = p.supplier_invoice_id left join public.fin_expenses e on e.org_id = p.org_id and e.id = p.expense_id left join public.pur_suppliers s on s.org_id = p.org_id and s.id = coalesce(pi.supplier_id, e.supplier_id)",
    "where": "p.org_id = $1 and p.status = 'recorded'",
    "period": "paid_on", "periodRequired": true, "currency": "p.currency::text",
    "columns": [
      {"key": "paid_on", "type": "date", "expr": "p.paid_on"},
      {"key": "payment_number", "type": "text", "expr": "p.number"},
      {"key": "direction", "type": "text", "expr": "p.direction"},
      {"key": "method", "type": "text", "expr": "p.method"},
      {"key": "party", "type": "text", "expr": "coalesce(c.name, s.name)"},
      {"key": "amount", "type": "money", "expr": "p.amount_minor"},
      {"key": "note", "type": "text", "expr": "p.note"}
    ]
  },
  "ledger_lines": {
    "module": "accounting", "roles": ["owner", "admin"],
    "from": "public.acc_entry_lines el join public.acc_entries e on e.org_id = el.org_id and e.id = el.entry_id join public.acc_accounts a on a.org_id = el.org_id and a.id = el.account_id",
    "where": "el.org_id = $1",
    "period": "entry_date", "periodRequired": true, "currency": "e.currency::text",
    "columns": [
      {"key": "entry_date", "type": "date", "expr": "e.entry_date"},
      {"key": "entry_number", "type": "text", "expr": "e.number"},
      {"key": "account_code", "type": "text", "expr": "a.code"},
      {"key": "account", "type": "text", "expr": "a.name"},
      {"key": "account_type", "type": "text", "expr": "a.kind"},
      {"key": "debit", "type": "money", "expr": "el.debit_minor"},
      {"key": "credit", "type": "money", "expr": "el.credit_minor"},
      {"key": "memo", "type": "text", "expr": "el.memo"}
    ]
  }
}
$j$::jsonb
$fn$;
revoke all on function public.rpt__catalog() from public, anon, authenticated;

-- The display order of the sources.
create or replace function public.rpt__source_order() returns text[]
language sql immutable as $$
  select array['sales_lines', 'sales_orders', 'purchase_lines', 'stock_on_hand', 'stock_moves', 'receivables', 'expenses', 'payments', 'ledger_lines']
$$;
revoke all on function public.rpt__source_order() from public, anon, authenticated;

-- The caller's company and role (any member role). Raises ORG_REQUIRED, NOT_A_MEMBER or FORBIDDEN.
create or replace function public.rpt__caller(out org uuid, out role text)
language plpgsql stable security definer set search_path = public as $$
begin
  org := public.require_org_role(array['owner', 'admin', 'member', 'viewer']);
  select m.role into role from public.memberships m where m.org_id = org and m.user_id = auth.uid() and m.disabled_at is null;
end $$;
revoke all on function public.rpt__caller() from public, anon, authenticated;

-- May this role use this source in this company now (its module on, the role in its list)?
create or replace function public.rpt__source_ok(p_src jsonb, p_org uuid, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_role = any (array(select jsonb_array_elements_text(p_src -> 'roles')))
     and exists (select 1 from public.org_modules m where m.org_id = p_org and m.module_key = p_src ->> 'module' and m.disabled_at is null)
$$;
revoke all on function public.rpt__source_ok(jsonb, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. checking a definition

-- The type of a source column, or null when the source has no such column.
create or replace function public.rpt__col_type(p_src jsonb, p_key text) returns text
language sql immutable as $$
  select c ->> 'type' from jsonb_array_elements(p_src -> 'columns') c where c ->> 'key' = p_key
$$;
revoke all on function public.rpt__col_type(jsonb, text) from public, anon, authenticated;

create or replace function public.rpt__col_expr(p_src jsonb, p_key text) returns text
language sql immutable as $$
  select c ->> 'expr' from jsonb_array_elements(p_src -> 'columns') c where c ->> 'key' = p_key
$$;
revoke all on function public.rpt__col_expr(jsonb, text) from public, anon, authenticated;

-- A text array from a jsonb array of strings (null when it is not one).
create or replace function public.rpt__strings(p jsonb) returns text[]
language sql immutable as $$
  select case when p is null or jsonb_typeof(p) = 'null' then '{}'::text[]
              when jsonb_typeof(p) <> 'array' then null
              when exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string') then null
              else array(select jsonb_array_elements_text(p)) end
$$;
revoke all on function public.rpt__strings(jsonb) from public, anon, authenticated;

-- Is p a valid filter value for a column of this type? (one value; 'between' and 'in' call it for each element)
create or replace function public.rpt__value_ok(p_type text, p jsonb) returns boolean
language plpgsql immutable as $$
declare d date;
begin
  if p is null then return false; end if;
  if p_type = 'text' then
    return jsonb_typeof(p) = 'string' and length(p #>> '{}') between 1 and 200;
  elsif p_type = 'number' then
    return jsonb_typeof(p) = 'number';
  elsif p_type = 'money' then
    return jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,15}$';
  elsif p_type = 'date' then
    if jsonb_typeof(p) <> 'string' or (p #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    begin d := (p #>> '{}')::date; exception when others then return false; end;
    return true;
  end if;
  return false;
end $$;
revoke all on function public.rpt__value_ok(text, jsonb) from public, anon, authenticated;

-- The output columns of a definition, in order: the chosen columns (or, when grouped, the group-by columns then the totals as
-- '<fn>_<column>'). Run only on a definition rpt__check accepted.
create or replace function public.rpt__output_keys(p_def jsonb) returns text[]
language sql immutable as $$
  select case when jsonb_array_length(coalesce(p_def -> 'groupBy', '[]')) > 0
    then public.rpt__strings(p_def -> 'groupBy')
         || array(select (t ->> 'fn') || '_' || (t ->> 'column') from jsonb_array_elements(coalesce(p_def -> 'totals', '[]')) with ordinality x(t, n) order by n)
    else public.rpt__strings(p_def -> 'columns') end
$$;
revoke all on function public.rpt__output_keys(jsonb) from public, anon, authenticated;

-- Checks a definition for this company and role. Returns the source. Raises INVALID_INPUT (with a plain detail), FORBIDDEN or
-- MODULE_DISABLED.
create or replace function public.rpt__check(p_def jsonb, p_org uuid, p_role text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_src     jsonb;
  v_cols    text[];
  v_groups  text[];
  v_keys    text[];
  v_type    text;
  v_op      text;
  v_fn      text;
  v_val     jsonb;
  v_from    date;
  v_to      date;
  e         jsonb;
  k         text;
  v_pairs   text[] := '{}';
begin
  if p_def is null or jsonb_typeof(p_def) <> 'object' then raise exception 'INVALID_INPUT' using detail = 'the report settings are missing'; end if;
  if exists (select 1 from jsonb_object_keys(p_def) x
              where x not in ('source', 'columns', 'filters', 'period', 'groupBy', 'totals', 'sort', 'limit', 'chart')) then
    raise exception 'INVALID_INPUT' using detail = 'unknown setting';
  end if;
  v_src := public.rpt__catalog() -> (p_def ->> 'source');
  if v_src is null then raise exception 'INVALID_INPUT' using detail = 'unknown source'; end if;
  if not exists (select 1 from public.org_modules m where m.org_id = p_org and m.module_key = v_src ->> 'module' and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;
  if not (p_role = any (array(select jsonb_array_elements_text(v_src -> 'roles')))) then raise exception 'FORBIDDEN'; end if;

  -- columns and group by: known keys, no repeats
  v_cols := public.rpt__strings(p_def -> 'columns');
  v_groups := public.rpt__strings(p_def -> 'groupBy');
  if v_cols is null or v_groups is null then raise exception 'INVALID_INPUT' using detail = 'columns and group by are lists of column names'; end if;
  if cardinality(v_cols) > 20 or cardinality(v_groups) > 2 then raise exception 'INVALID_INPUT' using detail = 'at most 20 columns and 2 group-by columns'; end if;
  if cardinality(v_cols) <> (select count(distinct x) from unnest(v_cols) x) or cardinality(v_groups) <> (select count(distinct x) from unnest(v_groups) x) then
    raise exception 'INVALID_INPUT' using detail = 'a column is chosen twice';
  end if;
  foreach k in array v_cols || v_groups loop
    if public.rpt__col_type(v_src, k) is null then raise exception 'INVALID_INPUT' using detail = format('unknown column %s', left(k, 40)); end if;
  end loop;
  foreach k in array v_groups loop
    if public.rpt__col_type(v_src, k) not in ('text', 'date') then raise exception 'INVALID_INPUT' using detail = 'group by a text or date column'; end if;
  end loop;
  if cardinality(v_groups) = 0 and cardinality(v_cols) = 0 then raise exception 'INVALID_INPUT' using detail = 'choose at least one column'; end if;

  -- totals
  if p_def ? 'totals' and jsonb_typeof(p_def -> 'totals') not in ('array', 'null') then raise exception 'INVALID_INPUT' using detail = 'totals is a list'; end if;
  if jsonb_array_length(coalesce(nullif(p_def -> 'totals', 'null'), '[]')) > 5 then raise exception 'INVALID_INPUT' using detail = 'at most 5 totals'; end if;
  for e in select x from jsonb_array_elements(coalesce(nullif(p_def -> 'totals', 'null'), '[]')) x loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'column') <> 'string' or jsonb_typeof(e -> 'fn') <> 'string' then
      raise exception 'INVALID_INPUT' using detail = 'a total needs a column and a function';
    end if;
    v_type := public.rpt__col_type(v_src, e ->> 'column');
    v_fn := e ->> 'fn';
    if v_type is null then raise exception 'INVALID_INPUT' using detail = format('unknown column %s', left(e ->> 'column', 40)); end if;
    if v_fn not in ('sum', 'count', 'avg', 'min', 'max')
       or (v_fn in ('sum', 'avg') and v_type not in ('number', 'money'))
       or (v_fn in ('min', 'max') and v_type = 'text') then
      raise exception 'INVALID_INPUT' using detail = format('%s cannot be used on that column', left(v_fn, 10));
    end if;
    if (v_fn || '_' || (e ->> 'column')) = any (v_pairs) then raise exception 'INVALID_INPUT' using detail = 'a total is chosen twice'; end if;
    v_pairs := v_pairs || (v_fn || '_' || (e ->> 'column'));
  end loop;
  if cardinality(v_groups) > 0 and cardinality(v_pairs) = 0 then raise exception 'INVALID_INPUT' using detail = 'a grouped report needs at least one total'; end if;

  -- filters: operators that fit the column's type; values checked here and passed as parameters when the report runs
  if p_def ? 'filters' and jsonb_typeof(p_def -> 'filters') not in ('array', 'null') then raise exception 'INVALID_INPUT' using detail = 'filters is a list'; end if;
  if jsonb_array_length(coalesce(nullif(p_def -> 'filters', 'null'), '[]')) > 10 then raise exception 'INVALID_INPUT' using detail = 'at most 10 filters'; end if;
  for e in select x from jsonb_array_elements(coalesce(nullif(p_def -> 'filters', 'null'), '[]')) x loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'column') <> 'string' or jsonb_typeof(e -> 'op') <> 'string' then
      raise exception 'INVALID_INPUT' using detail = 'a filter needs a column and an operator';
    end if;
    v_type := public.rpt__col_type(v_src, e ->> 'column');
    v_op := e ->> 'op';
    v_val := e -> 'value';
    if v_type is null then raise exception 'INVALID_INPUT' using detail = format('unknown column %s', left(e ->> 'column', 40)); end if;
    if not ((v_type = 'text' and v_op in ('eq', 'ne', 'in', 'contains', 'is_empty'))
         or (v_type in ('number', 'money') and v_op in ('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'))
         or (v_type = 'date' and v_op in ('eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'))) then
      raise exception 'INVALID_INPUT' using detail = format('%s cannot be used on that column', left(v_op, 10));
    end if;
    if v_op = 'is_empty' then
      if v_val is not null and jsonb_typeof(v_val) <> 'null' then raise exception 'INVALID_INPUT' using detail = '"is empty" takes no value'; end if;
    elsif v_op = 'in' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) not between 1 and 50
         or exists (select 1 from jsonb_array_elements(v_val) x where not public.rpt__value_ok('text', x)) then
        raise exception 'INVALID_INPUT' using detail = '"is one of" takes 1 to 50 texts';
      end if;
    elsif v_op = 'between' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) <> 2
         or not public.rpt__value_ok(v_type, v_val -> 0) or not public.rpt__value_ok(v_type, v_val -> 1) then
        raise exception 'INVALID_INPUT' using detail = '"between" takes two values';
      end if;
    elsif v_op = 'contains' then
      if not public.rpt__value_ok('text', v_val) or length(v_val #>> '{}') > 100 then raise exception 'INVALID_INPUT' using detail = '"contains" takes a text'; end if;
    elsif not public.rpt__value_ok(v_type, v_val) then
      raise exception 'INVALID_INPUT' using detail = 'a filter value does not fit its column';
    end if;
  end loop;

  -- period: required for sources that have one (except money owed), at most about 3 years
  if p_def ? 'period' and jsonb_typeof(p_def -> 'period') <> 'null' then
    if v_src ->> 'period' is null then raise exception 'INVALID_INPUT' using detail = 'this source has no period'; end if;
    if jsonb_typeof(p_def -> 'period') <> 'object' or not public.rpt__value_ok('date', p_def -> 'period' -> 'from') or not public.rpt__value_ok('date', p_def -> 'period' -> 'to')
       or exists (select 1 from jsonb_object_keys(p_def -> 'period') x where x not in ('from', 'to')) then
      raise exception 'INVALID_INPUT' using detail = 'the period needs a from and a to date';
    end if;
    v_from := (p_def -> 'period' ->> 'from')::date;
    v_to := (p_def -> 'period' ->> 'to')::date;
    if v_from > v_to or v_to - v_from > 1096 then raise exception 'INVALID_INPUT' using detail = 'the period is at most 3 years, from before to'; end if;
  elsif (v_src ->> 'periodRequired')::boolean then
    raise exception 'INVALID_INPUT' using detail = 'choose a period';
  end if;

  -- sort: output columns only
  v_keys := case when cardinality(v_groups) > 0 then v_groups || v_pairs else v_cols end;
  if p_def ? 'sort' and jsonb_typeof(p_def -> 'sort') not in ('array', 'null') then raise exception 'INVALID_INPUT' using detail = 'sort is a list'; end if;
  if jsonb_array_length(coalesce(nullif(p_def -> 'sort', 'null'), '[]')) > 3 then raise exception 'INVALID_INPUT' using detail = 'sort by at most 3 columns'; end if;
  for e in select x from jsonb_array_elements(coalesce(nullif(p_def -> 'sort', 'null'), '[]')) x loop
    if jsonb_typeof(e) <> 'object' or not ((e ->> 'column') = any (v_keys)) or coalesce(e ->> 'dir', '') not in ('asc', 'desc') then
      raise exception 'INVALID_INPUT' using detail = 'sort by a shown column, up or down';
    end if;
  end loop;

  -- limit
  if p_def ? 'limit' and jsonb_typeof(p_def -> 'limit') <> 'null' then
    if jsonb_typeof(p_def -> 'limit') <> 'number' or (p_def ->> 'limit') !~ '^[0-9]{1,4}$' or (p_def ->> 'limit')::int not between 1 and 5000 then
      raise exception 'INVALID_INPUT' using detail = 'the row limit is 1 to 5000';
    end if;
  end if;

  -- chart: drawn by the browser from the result; only its shape is checked
  if p_def ? 'chart' and jsonb_typeof(p_def -> 'chart') <> 'null' then
    if jsonb_typeof(p_def -> 'chart') <> 'object' or coalesce(p_def -> 'chart' ->> 'type', '') not in ('bar', 'line', 'pie')
       or not ((p_def -> 'chart' ->> 'x') = any (v_keys)) or not ((p_def -> 'chart' ->> 'y') = any (v_keys))
       or exists (select 1 from jsonb_object_keys(p_def -> 'chart') x where x not in ('type', 'x', 'y')) then
      raise exception 'INVALID_INPUT' using detail = 'the chart needs a type and two shown columns';
    end if;
  end if;
  return v_src;
end $$;
revoke all on function public.rpt__check(jsonb, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. running a report

-- The SQL condition for filter number p_i (0-based). The value is read from parameter $3 at run time, never put into the SQL text.
create or replace function public.rpt__filter_sql(p_src jsonb, p_f jsonb, p_i int) returns text
language plpgsql immutable as $$
declare
  v_expr text := public.rpt__col_expr(p_src, p_f ->> 'column');
  v_type text := public.rpt__col_type(p_src, p_f ->> 'column');
  v_cast text := case v_type when 'date' then '::date' when 'text' then '' else '::numeric' end;
  v_val  text := format('($3 -> %s ->> ''value'')', p_i);
begin
  return case p_f ->> 'op'
    when 'eq' then format('(%s) = %s%s', v_expr, v_val, v_cast)
    when 'ne' then format('(%s) is distinct from %s%s', v_expr, v_val, v_cast)
    when 'gt' then format('(%s) > %s%s', v_expr, v_val, v_cast)
    when 'gte' then format('(%s) >= %s%s', v_expr, v_val, v_cast)
    when 'lt' then format('(%s) < %s%s', v_expr, v_val, v_cast)
    when 'lte' then format('(%s) <= %s%s', v_expr, v_val, v_cast)
    when 'between' then format('(%s) between ($3 -> %s -> ''value'' ->> 0)%s and ($3 -> %s -> ''value'' ->> 1)%s', v_expr, p_i, v_cast, p_i, v_cast)
    when 'in' then format('(%s) = any (array(select jsonb_array_elements_text($3 -> %s -> ''value'')))', v_expr, p_i)
    when 'contains' then format('strpos(lower(%s), lower(%s)) > 0', v_expr, v_val)
    when 'is_empty' then case when v_type = 'text' then format('coalesce(%s, '''') = ''''', v_expr) else format('(%s) is null', v_expr) end
  end;
end $$;
revoke all on function public.rpt__filter_sql(jsonb, jsonb, int) from public, anon, authenticated;

-- Runs a checked definition for a company. Internal: rpt_run checks the caller first; later steps (alerts, schedules) call it for
-- the rule maker's company.
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
      'select coalesce(jsonb_agg(jsonb_build_array(%s) order by _rn), ''[]''::jsonb) from (select *, row_number() over (order by %s) as _rn from (select %s from %s where %s group by %s) q order by _rn limit %s) s',
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
      'select coalesce(jsonb_agg(jsonb_build_array(%s) order by _rn), ''[]''::jsonb) from (select *, row_number() over (order by %s) as _rn from (select %s from %s where %s) q order by _rn limit %s) s',
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

-- The builder's Run button: checks the definition for the caller's company and role, then runs it.
create or replace function public.rpt_run(p_definition jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c     record;
  v_src jsonb;
begin
  select * into c from public.rpt__caller();
  v_src := public.rpt__check(p_definition, c.org, c.role);
  return public.rpt__execute(p_definition, v_src, c.org);
end $$;
revoke all on function public.rpt_run(jsonb) from public, anon;
grant execute on function public.rpt_run(jsonb) to authenticated;

-- ---------------------------------------------------------------- 4. the sources this person may use

create or replace function public.rpt_sources() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c   record;
  cat jsonb := public.rpt__catalog();
begin
  select * into c from public.rpt__caller();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', k, 'module', cat -> k ->> 'module', 'period', cat -> k -> 'period', 'periodRequired', cat -> k -> 'periodRequired',
             'hasCurrency', cat -> k ->> 'currency' is not null,
             'columns', (select jsonb_agg(jsonb_build_object('key', col ->> 'key', 'type', col ->> 'type') order by n)
                           from jsonb_array_elements(cat -> k -> 'columns') with ordinality z(col, n)))
           order by array_position(public.rpt__source_order(), k))
      from unnest(public.rpt__source_order()) k
     where public.rpt__source_ok(cat -> k, c.org, c.role)), '[]'::jsonb);
end $$;
revoke all on function public.rpt_sources() from public, anon;
grant execute on function public.rpt_sources() to authenticated;

-- ---------------------------------------------------------------- 5. saved reports

create table if not exists public.rpt_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  name         text not null check (length(trim(name)) between 1 and 100),
  description  text check (description is null or length(description) <= 500),
  definition   jsonb not null,
  template_key text check (template_key is null or template_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  visibility   text not null check (visibility in ('company', 'private')),
  owner_id     uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, id)
);
create index if not exists rpt_reports_org_idx on public.rpt_reports(org_id, visibility, owner_id) where deleted_at is null;

alter table public.rpt_reports enable row level security;
revoke all on public.rpt_reports from anon, authenticated;
grant select on public.rpt_reports to authenticated;
drop policy if exists rpt_reports_read on public.rpt_reports;
create policy rpt_reports_read on public.rpt_reports for select to authenticated
  using (public.is_org_member(org_id) and (visibility = 'company' or owner_id = (select auth.uid())));

-- Save a report: p_id null makes a new one. Private reports: owners, admins and members (only the person who made it sees, changes
-- or deletes it). Company reports: owners and admins. Viewers save nothing. The definition must be one the saver may run. A name is
-- used once among the live reports the saver can see. Audited, before and after.
create or replace function public.rpt_save_report(p_id uuid, p_name text, p_description text, p_definition jsonb, p_visibility text,
                                                  p_template_key text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c      record;
  r      public.rpt_reports;
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), '');
begin
  select * into c from public.rpt__caller();
  if c.role = 'viewer' then raise exception 'FORBIDDEN'; end if;
  if p_visibility is null or p_visibility not in ('company', 'private') then raise exception 'INVALID_INPUT' using detail = 'company or private'; end if;
  if p_visibility = 'company' and c.role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if length(v_name) not between 1 and 100 then raise exception 'INVALID_INPUT' using detail = 'the name is 1 to 100 characters'; end if;
  if v_desc is not null and length(v_desc) > 500 then raise exception 'INVALID_INPUT' using detail = 'the description is at most 500 characters'; end if;
  perform public.rpt__check(p_definition, c.org, c.role);

  if p_id is not null then
    select * into r from public.rpt_reports x where x.org_id = c.org and x.id = p_id and x.deleted_at is null for update;
    if not found or (r.visibility = 'private' and r.owner_id <> auth.uid()) then raise exception 'NOT_FOUND'; end if;
    if r.visibility = 'company' and c.role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  end if;
  if exists (select 1 from public.rpt_reports x
              where x.org_id = c.org and x.deleted_at is null and x.id is distinct from p_id and lower(trim(x.name)) = lower(v_name)
                and (x.visibility = 'company' or x.owner_id = auth.uid())) then
    raise exception 'DUPLICATE_NAME';
  end if;

  if p_id is null then
    insert into public.rpt_reports (org_id, name, description, definition, template_key, visibility, owner_id)
    values (c.org, v_name, v_desc, p_definition, p_template_key, p_visibility, auth.uid())
    returning id into v_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
    values (c.org, auth.uid(), 'reports.report.created', 'report', v_id::text,
            format('Report "%s" saved (%s, source %s)', v_name, p_visibility, p_definition ->> 'source'),
            jsonb_build_object('name', v_name, 'description', v_desc, 'visibility', p_visibility, 'template_key', p_template_key, 'definition', p_definition));
    return v_id;
  end if;

  update public.rpt_reports x set name = v_name, description = v_desc, definition = p_definition, visibility = p_visibility, updated_at = now()
   where x.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (c.org, auth.uid(), 'reports.report.changed', 'report', r.id::text, format('Report "%s" changed', v_name),
          jsonb_build_object('name', r.name, 'description', r.description, 'visibility', r.visibility, 'definition', r.definition),
          jsonb_build_object('name', v_name, 'description', v_desc, 'visibility', p_visibility, 'definition', p_definition));
  return r.id;
end $$;
revoke all on function public.rpt_save_report(uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function public.rpt_save_report(uuid, text, text, jsonb, text, text) to authenticated;

-- Delete (soft) a saved report: the same people who may change it. Audited.
create or replace function public.rpt_delete_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
  r public.rpt_reports;
begin
  select * into c from public.rpt__caller();
  if c.role = 'viewer' then raise exception 'FORBIDDEN'; end if;
  select * into r from public.rpt_reports x where x.org_id = c.org and x.id = p_id and x.deleted_at is null for update;
  if not found or (r.visibility = 'private' and r.owner_id <> auth.uid()) then raise exception 'NOT_FOUND'; end if;
  if r.visibility = 'company' and c.role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  update public.rpt_reports x set deleted_at = now(), updated_at = now() where x.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (c.org, auth.uid(), 'reports.report.deleted', 'report', r.id::text, format('Report "%s" deleted', r.name),
          jsonb_build_object('name', r.name, 'visibility', r.visibility, 'definition', r.definition));
end $$;
revoke all on function public.rpt_delete_report(uuid) from public, anon;
grant execute on function public.rpt_delete_report(uuid) to authenticated;

-- ---------------------------------------------------------------- 6. "all apps on" includes Reports & Insights

create or replace function public.core_enable_all_modules(p_org_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k text; n int := 0;
begin
  if not exists (select 1 from public.organizations where id = p_org_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  foreach k in array array['inventory', 'tasks', 'messaging', 'purchasing', 'sales', 'finance', 'alerts', 'reports'] loop
    if not exists (select 1 from public.org_modules where org_id = p_org_id and module_key = k and disabled_at is null) then
      insert into public.org_modules (org_id, module_key, enabled_at, disabled_at) values (p_org_id, k, now(), null)
      on conflict (org_id, module_key) do update set enabled_at = now(), disabled_at = null;
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary) values (p_org_id, 'module.enabled', 'module', k, k || ' switched on (all apps on by default)');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- 1. The table: RLS on, select only for signed-in users, nothing for anonymous (expect true, true, false, false, false).
select (select relrowsecurity from pg_class where oid = 'public.rpt_reports'::regclass) as rls_on,
       has_table_privilege('authenticated', 'public.rpt_reports', 'select') as users_read,
       has_table_privilege('authenticated', 'public.rpt_reports', 'insert') or has_table_privilege('authenticated', 'public.rpt_reports', 'update')
         or has_table_privilege('authenticated', 'public.rpt_reports', 'delete') or has_table_privilege('authenticated', 'public.rpt_reports', 'truncate') as users_write,
       has_table_privilege('anon', 'public.rpt_reports', 'select') as anon_read,
       has_function_privilege('anon', 'public.rpt_run(jsonb)', 'execute') as anon_runs;

-- 2. The functions: signed-in users run, save and delete; the internal ones are closed (expect true, true, true, false, false).
select has_function_privilege('authenticated', 'public.rpt_run(jsonb)', 'execute') as users_run,
       has_function_privilege('authenticated', 'public.rpt_save_report(uuid,text,text,jsonb,text,text)', 'execute') as users_save,
       has_function_privilege('authenticated', 'public.rpt_sources()', 'execute') as users_sources,
       has_function_privilege('authenticated', 'public.rpt__execute(jsonb,jsonb,uuid)', 'execute') as users_execute_internal,
       has_function_privilege('authenticated', 'public.rpt__catalog()', 'execute') as users_catalog;

-- 3. Nine sources in the catalogue (expect 9).
select count(*) as sources from jsonb_object_keys(public.rpt__catalog());
