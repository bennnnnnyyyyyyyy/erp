-- 089_vat_summary.sql
-- VAT part 3 (documentation/plans/VAT_PLAN.md section 10 item 3, and section 14's "Part 3 must include"): the VAT summary for a
-- period, laid out like the return. Read only. Owners and admins (the figures are the company's tax position).
--   fin_vat_summary(p_from, p_to) returns:
--   * sales: rows by kind ('taxable' per rate, 'zero_rated' = ETA V001/V002, 'exempt' = no VAT), each with invoices (net, VAT), notes
--     (approved credit notes negative, debit notes positive, dated by their approval day) and the total;
--   * purchases: rows by kind of purchase ('local', 'capital', 'import'), with net, deductible VAT and non-deductible VAT; bill lines
--     carry their share of the VAT as printed (shared by computed VAT, rounding to the line with the most VAT), expenses their own;
--   * totals: output VAT, deductible input VAT, VAT due (positive) or credit (negative);
--   * warnings: not_registered, before_vat_from (the period starts before the company's VAT start), partial_deduction (taxable and
--     exempt sales in the same period: input VAT is not apportioned yet, so it may be over-claimed), other_currency (documents not in
--     the company currency are left out; their count), excludes_supplier_credit_notes (always, until those exist);
--   * documents: every document behind the figures, with its section, for drill-down (at most 5000).
-- Documents counted: issued customer invoices (by invoice date), approved credit/debit notes (by approval day, company time zone),
-- supplier bills (by invoice date), recorded expenses (by expense date); in the company currency only. Section names are ours until
-- the accountant gives the exact return (Form 10) headings.
-- Depends on sql/001-088. Rerun-safe. Then run sql/tests/085_vat_summary.sql.

begin;

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
  v_warn := v_warn || '"excludes_supplier_credit_notes"'::jsonb;

  return jsonb_build_object('from', p_from, 'to', p_to, 'currency', v_cur, 'vatRegistered', v_reg, 'vatFrom', v_from,
    'sales', v_sales, 'purchases', v_purch,
    'outputTaxMinor', v_out, 'inputTaxMinor', v_in, 'dueMinor', v_out - v_in,
    'warnings', v_warn, 'otherCurrencyDocuments', v_other, 'documents', v_docs);
end $$;
revoke all on function public.fin_vat_summary(date, date) from public, anon;
grant execute on function public.fin_vat_summary(date, date) to authenticated;

commit;

-- Verification (read-only): signed-in users can call it (the function admits owners and admins only), anonymous cannot.
select has_function_privilege('authenticated', 'public.fin_vat_summary(date, date)', 'execute') as users_can_read,
       has_function_privilege('anon', 'public.fin_vat_summary(date, date)', 'execute') as anon_can_read;
