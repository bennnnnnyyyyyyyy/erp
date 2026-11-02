-- sql/seed/006_cosmetics_topup.sql
-- DEMO DATA, not a migration. Continues the history of the sample organization "Demo Cosmetics Factory (sample data)" up to today.
-- Why: sql/seed/004 writes the 12 months BEFORE the month it was run in (it ran on 30 Oct 2026), so October and everything after it
-- had no sales, stock movements, expenses or purchases, and the owner home read "Made 0" for the last full month. This script adds every
-- month after the last month that has sales, up to today, with the same patterns, prices and customers as the original seed.
--
-- Rules it follows: nothing is dated in the future (an order, delivery, bill or payment that would fall after today is left out); the
-- current month stops at today; month-end production consumption is added only after its day has passed. Rerun-safe: each month it adds is
-- recorded in the audit log ('demo.topup'), and a month with sales or a record is skipped. It only inserts, never deletes, and touches only
-- the organization with slug 'demo-cosmetics'. Like 004 it writes history directly, so the added rows have no per-row audit entries (one
-- summary row per month is written).
-- The near-expiry and quarantined lots created at the end of 004 are set aside while the older sales are issued (the ledger issues the
-- soonest-to-expire stock first) and put back afterwards, so the expiry demo is unchanged.
--
-- TEST FIRST: set v_dry to true. Everything is rolled back and the message shows what would be added. Then set it to false and run.
-- Run: supabase db query --linked -f sql/seed/006_cosmetics_topup.sql

do $$
declare
  v_dry boolean := false;
  uo uuid; um uuid; ur uuid; oid uuid;
  v_req int; v_pay int; v_exp int; v_inv int; v_po int; v_so int;
  m int; v_ms date; d numeric; units numeric; v_last date; v_new text := '';
  r record; o record; l record; g record;
  rid uuid; sid uuid; iid uuid; pid uuid; bid uuid; poid uuid; siid uuid; pol uuid;
  v_total bigint; v_paid bigint; v_cost bigint; v_qty numeric; v_recv date; v_age int; h int; v_catid uuid; v_exid uuid;
  v_first text; v_msg text;
begin
  select id into oid from public.organizations where slug = 'demo-cosmetics';
  if oid is null then raise notice 'no sample organization, nothing to do'; return; end if;
  select id into uo from auth.users where lower(email) = 'chris.johnson.wiz@gmail.com';
  select id into um from auth.users where lower(email) = 'joseph.brown.wiz@gmail.com';
  select id into ur from auth.users where lower(email) = 'grant.holden.wiz@gmail.com';
  if uo is null or um is null or ur is null then raise exception 'the three demo users are missing'; end if;

  select coalesce(max(value) filter (where key = 'request'), 0), coalesce(max(value) filter (where key = 'sales_order'), 0), coalesce(max(value) filter (where key = 'sales_invoice'), 0),
         coalesce(max(value) filter (where key = 'payment'), 0), coalesce(max(value) filter (where key = 'expense'), 0), coalesce(max(value) filter (where key = 'purchase_order'), 0)
    into v_req, v_so, v_inv, v_pay, v_exp, v_po from public.inv_counters where org_id = oid;
  -- the stored counters can be behind the real numbers (004 stored the last order it created, not the highest), so take the highest number in use
  v_req := greatest(v_req, (select coalesce(max(substring(number from '[0-9]+$')::int), 0) from public.inv_requests where org_id = oid));
  v_so  := greatest(v_so,  (select coalesce(max(substring(number from '[0-9]+$')::int), 0) from public.sal_orders where org_id = oid));
  v_inv := greatest(v_inv, (select coalesce(max(substring(number from '[0-9]+$')::int), 0) from public.sal_invoices where org_id = oid));
  v_pay := greatest(v_pay, (select coalesce(max(substring(number from '[0-9]+$')::int), 0) from public.fin_payments where org_id = oid));
  v_exp := greatest(v_exp, (select coalesce(max(substring(number from '[0-9]+$')::int), 0) from public.fin_expenses where org_id = oid));
  v_po  := greatest(v_po,  (select coalesce(max(substring(number from '[0-9]+$')::int), 0) from public.pur_orders where org_id = oid));
  select date_trunc('month', max(invoice_date))::date into v_last from public.sal_invoices where org_id = oid;
  if v_last is null then raise exception 'the sample organization has no invoices; run sql/seed/004 first'; end if;
  if v_last >= date_trunc('month', current_date)::date and exists (select 1 from public.audit_log a where a.org_id = oid and a.action = 'demo.topup' and a.entity_id = to_char(current_date, 'YYYY-MM')) then
    raise notice 'already topped up to this month, nothing to do'; return;
  end if;

  alter table public.inv_requests disable trigger inv_requests_notify;

  -- ------------------------------------------------------------ the same lookups the original seed kept in temp tables
  create temp table t_wh (code text primary key, id uuid) on commit drop;
  insert into t_wh select w.code, w.id from public.inv_warehouses w where w.org_id = oid;

  create temp table t_def (sku text, name text, name_ar text, uom text, kind text, cost bigint, price bigint, wh text, sup int, shelf int, cat text, inten numeric) on commit drop;
  insert into t_def values
   ('R-GLY','Glycerin','جلسرين','kg','raw',5500,null,'RAW',1,36,null,0.012),
   ('R-CET','Cetyl alcohol','كحول السيتيل','kg','raw',9500,null,'RAW',1,36,null,0.008),
   ('R-STE','Stearic acid','حمض الستياريك','kg','raw',7800,null,'RAW',1,36,null,0.006),
   ('R-SHE','Shea butter','زبدة الشيا','kg','raw',32000,null,'RAW',2,24,null,0.004),
   ('R-ALM','Sweet almond oil','زيت اللوز الحلو','l','raw',28000,null,'RAW',2,24,null,0.002),
   ('R-ARG','Argan oil','زيت الأرجان','l','raw',95000,null,'RAW',3,24,null,0.0005),
   ('R-ALO','Aloe vera extract','مستخلص الألوفيرا','l','raw',18000,null,'COLD',3,12,null,0.003),
   ('R-PAN','Panthenol','بانثينول','kg','raw',120000,null,'COLD',3,18,null,0.0003),
   ('R-NIA','Niacinamide','نياسيناميد','kg','raw',85000,null,'RAW',3,24,null,0.0004),
   ('R-HYA','Hyaluronic acid','حمض الهيالورونيك','kg','raw',450000,null,'COLD',3,12,null,0.00005),
   ('R-VIE','Vitamin E','فيتامين هـ','kg','raw',38000,null,'COLD',3,18,null,0.0003),
   ('R-TIO','Titanium dioxide','ثاني أكسيد التيتانيوم','kg','raw',21000,null,'RAW',4,36,null,0.003),
   ('R-ZNO','Zinc oxide','أكسيد الزنك','kg','raw',16000,null,'RAW',4,36,null,0.002),
   ('R-PRE','Preservative blend','خليط حافظ','kg','raw',42000,null,'RAW',5,24,null,0.004),
   ('R-CIT','Citric acid','حمض الستريك','kg','raw',3200,null,'RAW',5,36,null,0.001),
   ('R-COL','Colorant blend','خليط ملون','kg','raw',26000,null,'RAW',5,36,null,0.0005),
   ('R-FR1','Fragrance rose','عطر الورد','l','raw',140000,null,'RAW',6,24,null,0.0006),
   ('R-FR2','Fragrance oud','عطر العود','l','raw',175000,null,'RAW',6,24,null,0.0004),
   ('R-FR3','Fragrance fresh','عطر منعش','l','raw',130000,null,'RAW',6,24,null,0.0005),
   ('R-SLE','SLES surfactant','مادة SLES','kg','raw',4800,null,'RAW',7,24,null,0.03),
   ('R-CAP','Cocamidopropyl betaine','كوكاميدوبروبيل بيتاين','kg','raw',6200,null,'RAW',7,24,null,0.008),
   ('P-B100','PET bottle 100 ml','زجاجة 100 مل','piece','pack',450,null,'PACK',9,null,null,0.35),
   ('P-B250','PET bottle 250 ml','زجاجة 250 مل','piece','pack',650,null,'PACK',9,null,null,0.25),
   ('P-B500','HDPE bottle 500 ml','زجاجة 500 مل','piece','pack',900,null,'PACK',9,null,null,0.10),
   ('P-J50','Jar 50 ml','برطمان 50 مل','piece','pack',700,null,'PACK',9,null,null,0.08),
   ('P-J200','Jar 200 ml','برطمان 200 مل','piece','pack',1100,null,'PACK',9,null,null,0.06),
   ('P-PUMP','Pump dispenser','مضخة','piece','pack',300,null,'PACK',9,null,null,0.30),
   ('P-CAP','Screw cap','غطاء','piece','pack',150,null,'PACK',9,null,null,0.60),
   ('P-TUBE','Tube 100 ml','أنبوب 100 مل','piece','pack',500,null,'PACK',10,null,null,0.05),
   ('P-DROP','Dropper bottle 30 ml','زجاجة قطارة 30 مل','piece','pack',1400,null,'PACK',10,null,null,0.05),
   ('P-LBL','Printed label','ملصق مطبوع','piece','pack',90,null,'PACK',12,null,null,1.00),
   ('P-SLV','Shrink sleeve','غلاف حراري','piece','pack',60,null,'PACK',12,null,null,0.30),
   ('P-CTN','Carton box','علبة كرتون','piece','pack',250,null,'PACK',10,null,null,0.30),
   ('F-SHA','Shampoo 400 ml','شامبو 400 مل','piece','fg',2400,4500,'FG',null,30,'reg',null),
   ('F-CON','Conditioner 400 ml','بلسم 400 مل','piece','fg',2600,4800,'FG',null,30,'reg',null),
   ('F-LOT','Body lotion 400 ml','لوشن للجسم 400 مل','piece','fg',2900,5500,'FG',null,30,'winter',null),
   ('F-HND','Hand cream 100 ml','كريم لليدين 100 مل','piece','fg',1500,3200,'FG',null,24,'winter',null),
   ('F-FWS','Face wash 150 ml','غسول للوجه 150 مل','piece','fg',2000,4200,'FG',null,24,'reg',null),
   ('F-SER','Vitamin C serum 30 ml','سيروم فيتامين سي 30 مل','piece','fg',6500,14500,'FG',null,18,'reg',null),
   ('F-SUN','Sunscreen SPF 50 100 ml','واقي شمس SPF 50','piece','fg',4200,9500,'FG',null,24,'sun',null),
   ('F-LIP','Lip balm 10 g','مرطب شفاه','piece','fg',700,1900,'FG',null,24,'winter',null),
   ('F-SHW','Shower gel 500 ml','جل استحمام 500 مل','piece','fg',2200,4200,'FG',null,30,'reg',null),
   ('F-OIL','Hair oil 100 ml','زيت شعر 100 مل','piece','fg',3000,6500,'FG',null,24,'reg',null),
   ('F-CRM','Night cream 50 ml','كريم ليلي 50 مل','piece','fg',5200,12500,'FG',null,24,'reg',null),
   ('F-MSK','Clay face mask 100 ml','ماسك طين للوجه','piece','fg',3400,7800,'FG',null,18,'reg',null);

  create temp table t_item (sku text primary key, id uuid, kind text, cost bigint, price bigint, wh text, sup int, shelf int, cat text, inten numeric, fgidx int) on commit drop;
  insert into t_item select d.sku, i.id, d.kind, d.cost, d.price, d.wh, d.sup, d.shelf, d.cat, d.inten,
                            case when d.kind = 'fg' then row_number() over (partition by d.kind order by d.sku)::int end
    from t_def d join public.inv_items i on i.org_id = oid and i.sku = d.sku;

  create temp table t_sup (idx int primary key, id uuid) on commit drop;
  insert into t_sup select v.idx, s.id from (values (1,'Delta Chemical Trading (sample)'),(2,'Nile Naturals Oils (sample)'),(3,'Cairo Actives Import (sample)'),(4,'Alexandria Minerals (sample)'),
      (5,'Giza Additives (sample)'),(6,'Cairo Fragrance Imports (sample)'),(7,'Suez Surfactants (sample)'),(8,'Upper Egypt Transport (sample)'),(9,'Delta Plastics (sample)'),
      (10,'Mahalla Cartons (sample)'),(11,'Ismailia Utilities (sample)'),(12,'Alex Label Printing (sample)')) v(idx, nm) join public.pur_suppliers s on s.org_id = oid and s.name = v.nm;

  create temp table t_cust (idx int primary key, id uuid, scale numeric, discount numeric) on commit drop;
  insert into t_cust select v.idx, c.id, case v.nm when 'Gulf Export Buyer (sample)' then 3.0 when 'Online Beauty Shop (sample)' then 0.5 when 'Cairo Pharmacy Chain (sample)' then 1.6 else 1.0 end,
         (abs(hashtext(v.nm)) % 12) / 100.0
    from (values (1,'Cairo Pharmacy Chain (sample)'),(2,'Delta Supermarkets Distribution (sample)'),(3,'Alexandria Beauty Stores (sample)'),(4,'Gulf Export Buyer (sample)'),(5,'Online Beauty Shop (sample)'),
      (6,'Upper Egypt Wholesale (sample)'),(7,'Maadi Care Centers (sample)'),(8,'Nasr City Cosmetics (sample)'),(9,'Port Said Trading (sample)'),(10,'Hospital Supply Group (sample)')) v(idx, nm)
    join public.sal_customers c on c.org_id = oid and c.name = v.nm;

  -- ------------------------------------------------------------ the orders of the missing months (same formula as 004; numbers continue from the counters)
  create temp table t_orders (n int primary key, ms date, cust int, odate date) on commit drop;
  insert into t_orders
  select v_so + row_number() over (order by x.ms, c.idx, k)::int, x.ms, c.idx, (x.ms + (2 + abs(hashtext('d' || x.ms || c.idx || k)) % 24))::date
    from (select (date_trunc('month', current_date) - make_interval(months => mm))::date as ms from generate_series(0, 12) mm) x
    cross join t_cust c
    cross join lateral generate_series(1, 2 + abs(hashtext('n' || x.ms || c.idx)) % 2) k
   where x.ms > v_last
     and not exists (select 1 from public.audit_log a where a.org_id = oid and a.action = 'demo.topup' and a.entity_id = to_char(x.ms, 'YYYY-MM'))
     and (x.ms + (2 + abs(hashtext('d' || x.ms || c.idx || k)) % 24) + 2) <= current_date;    -- invoiced by today
  create temp table t_lines (n int, j int, sku text, qty int, price bigint, primary key (n, j)) on commit drop;
  insert into t_lines
  select so.n, j, f.sku,
         greatest(6, (round(360 * c.scale * (case f.cat
              when 'sun' then case when extract(month from so.odate) between 5 and 9 then 1.8 else 0.5 end
              when 'winter' then case when extract(month from so.odate) in (11, 12, 1, 2) then 1.6 else 0.7 end
              else 1.0 end) * (0.5 + (abs(hashtext('q' || so.n || j)) % 100) / 100.0) / 6.0) * 6)::int),
         round(f.price * (1 - c.discount))::bigint
    from t_orders so join t_cust c on c.idx = so.cust
    cross join lateral generate_series(0, abs(hashtext('l' || so.n)) % 3) j
    join t_item f on f.kind = 'fg' and f.fgidx = (abs(hashtext('i' || so.n)) + j * 5) % 12 + 1;

  -- the lots made to show near-expiry stock are set aside, so the older sales do not use them up
  update public.inv_batches set status = 'quarantined' where org_id = oid and batch_no like 'NEAR-%';

  for m in reverse 12..0 loop
    v_ms := (date_trunc('month', current_date) - make_interval(months => m))::date;
    continue when v_ms <= v_last or exists (select 1 from public.audit_log a where a.org_id = oid and a.action = 'demo.topup' and a.entity_id = to_char(v_ms, 'YYYY-MM'));
    v_new := v_new || case when v_new = '' then '' else ', ' end || to_char(v_ms, 'YYYY-MM');
    d := 0.10 * (12 - m) / 11.0;                                  -- input prices drift up about 10% over the year
    select coalesce(sum(tl.qty), 0) into units from t_lines tl join t_orders so on so.n = tl.n where so.ms = v_ms;

    -- (a) finished goods "received from production" on day 1, 15% more than the month sells
    for r in select i.sku, i.id, i.cost, i.shelf, ceil(sum(tl.qty) * 1.15 / 6.0)::int * 6 as q
               from t_lines tl join t_orders so on so.n = tl.n join t_item i on i.sku = tl.sku where so.ms = v_ms group by i.sku, i.id, i.cost, i.shelf loop
      insert into public.inv_batches (org_id, item_id, batch_no, mfg_date, expiry_date, created_by, created_at)
      values (oid, r.id, 'B' || to_char(v_ms, 'YYMM') || '-' || right(r.sku, 3), v_ms, v_ms + make_interval(months => r.shelf), um, v_ms + time '08:00') returning id into bid;
      perform set_config('erp.batch_id', bid::text, true);
      insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, ref, posted_by, posted_at, unit_cost_minor)
      values (oid, r.id, (select id from t_wh where code = 'FG'), r.q, 'receipt', 'PROD-' || to_char(v_ms, 'YYMM') || '-' || right(r.sku, 3), um, v_ms + time '08:00', round(r.cost * (1 + d)));
      perform set_config('erp.batch_id', '', true);
    end loop;

    -- (b) purchase orders for raw materials and packaging, one per supplier and warehouse, received after the supplier's lead time
    for g in select i.sup, i.wh from t_item i where i.kind in ('raw', 'pack') group by i.sup, i.wh order by i.sup, i.wh loop
      v_recv := (v_ms + 1 + case when g.sup = 6 then 18 + abs(hashtext('lead' || v_ms || g.sup)) % 6 else 4 + abs(hashtext('lead' || v_ms || g.sup)) % 4 end)::date;
      continue when v_recv + 2 > current_date;
      v_po := v_po + 1;
      insert into public.pur_orders (org_id, number, supplier_id, warehouse_id, status, currency, created_by, received_by, received_at, created_at, updated_at)
      values (oid, 'PO-' || lpad(v_po::text, 4, '0'), (select id from t_sup where idx = g.sup), (select id from t_wh where code = g.wh), 'received', 'EGP', um, um, v_recv + time '10:00', v_ms + 1 + time '09:00', v_recv + time '10:00')
      returning id into poid;
      v_total := 0;
      for r in select i.sku, i.id, i.cost, i.kind, i.shelf, i.inten from t_item i where i.sup = g.sup and i.wh = g.wh and i.kind in ('raw', 'pack') order by i.sku loop
        v_qty := case when r.kind = 'raw' then round(units * r.inten * 1.25, 3) else ceil(units * r.inten * 1.25) end;
        continue when v_qty <= 0;
        v_cost := round(r.cost * (1 + d));
        insert into public.pur_order_lines (org_id, order_id, item_id, qty, unit_cost_minor, created_at, updated_at) values (oid, poid, r.id, v_qty, v_cost, v_ms + 1 + time '09:00', v_ms + 1 + time '09:00') returning id into pol;
        if r.kind = 'raw' then
          insert into public.inv_batches (org_id, item_id, batch_no, mfg_date, expiry_date, supplier_id, created_by, created_at)
          values (oid, r.id, 'L' || to_char(v_ms, 'YYMM') || '-' || right(r.sku, 3), v_recv - 10, v_recv + make_interval(months => r.shelf + 12), (select id from t_sup where idx = g.sup), um, v_recv + time '10:00') returning id into bid;
          perform set_config('erp.batch_id', bid::text, true);
        end if;
        insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, ref, posted_by, posted_at, unit_cost_minor)
        values (oid, r.id, (select id from t_wh where code = g.wh), v_qty, 'receipt', 'PO-' || lpad(v_po::text, 4, '0'), um, v_recv + time '10:00', v_cost);
        perform set_config('erp.batch_id', '', true);
        v_total := v_total + round(v_qty * v_cost);
        -- the supplier's bill is created lazily below once the lines exist
      end loop;
      continue when v_total = 0;
      -- supplier invoice (billed in full) and its payment
      insert into public.pur_supplier_invoices (org_id, number, supplier_id, order_id, invoice_date, currency, created_by, created_at)
      values (oid, 'SI-' || lpad(v_po::text, 4, '0'), (select id from t_sup where idx = g.sup), poid, v_recv + 2, 'EGP', uo, v_recv + 2 + time '11:00') returning id into siid;
      insert into public.pur_supplier_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_cost_minor, created_at)
      select oid, siid, pl.id, pl.qty, pl.unit_cost_minor, v_recv + 2 + time '11:00' from public.pur_order_lines pl where pl.order_id = poid;
      v_age := current_date - (v_recv + 2);
      h := abs(hashtext('sp' || v_po)) % 100;
      if v_age > 40 and h < (case when g.sup = 6 then 45 else 90 end) then
        v_pay := v_pay + 1;
        insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, supplier_invoice_id, created_by, created_at)
        values (oid, 'PAY-' || lpad(v_pay::text, 4, '0'), 'out', v_total, 'EGP', v_recv + 2 + 25 + h % 10, 'bank', siid, uo, v_recv + 2 + 25 + h % 10 + time '12:00');
      end if;
    end loop;

    -- (c) sales orders of the month: approved by the manager, issued from stock, invoiced, mostly paid
    for o in select * from t_orders where t_orders.ms = v_ms order by odate, n loop
      v_req := v_req + 1; v_so := o.n; v_inv := v_inv + 1;
      insert into public.inv_requests (org_id, number, requester_id, warehouse_id, reason, status, decided_by, decided_at, created_at, updated_at)
      values (oid, 'OUT-' || lpad(v_req::text, 4, '0'), ur, (select id from t_wh where code = 'FG'), 'Sales order SO-' || lpad(o.n::text, 4, '0'), 'approved', um, o.odate + time '11:00', o.odate + time '09:00', o.odate + time '11:00')
      returning id into rid;
      insert into public.inv_approvals (org_id, request_id, decision, approver_id, channel, decided_at) values (oid, rid, 'approved', um, 'app', o.odate + time '11:00');
      insert into public.inv_request_lines (org_id, request_id, item_id, qty, created_at) select oid, rid, i.id, tl.qty, o.odate + time '09:00' from t_lines tl join t_item i on i.sku = tl.sku where tl.n = o.n;
      insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, ref, posted_by, posted_at)
      select oid, i.id, (select id from t_wh where code = 'FG'), -tl.qty, 'issue', rid, 'SO-' || lpad(o.n::text, 4, '0'), ur, o.odate + 1 + time '10:00' from t_lines tl join t_item i on i.sku = tl.sku where tl.n = o.n order by i.sku;
      update public.inv_requests set status = 'issued', issued_by = ur, issued_at = o.odate + 1 + time '10:00' where id = rid;
      insert into public.sal_orders (org_id, number, customer_id, warehouse_id, status, currency, request_id, created_by, created_at, updated_at)
      values (oid, 'SO-' || lpad(o.n::text, 4, '0'), (select id from t_cust where idx = o.cust), (select id from t_wh where code = 'FG'), 'stock_requested', 'EGP', rid, ur, o.odate + time '09:00', o.odate + 1 + time '10:00') returning id into sid;
      insert into public.sal_order_lines (org_id, order_id, item_id, qty, unit_price_minor, created_at)
      select oid, sid, i.id, tl.qty, tl.price, o.odate + time '09:00' from t_lines tl join t_item i on i.sku = tl.sku where tl.n = o.n;
      insert into public.sal_invoices (org_id, number, order_id, customer_id, invoice_date, currency, status, created_by, created_at)
      values (oid, 'INV-' || lpad(v_inv::text, 4, '0'), sid, (select id from t_cust where idx = o.cust), o.odate + 2, 'EGP', 'issued', uo, o.odate + 2 + time '12:00') returning id into iid;
      insert into public.sal_invoice_lines (org_id, invoice_id, order_line_id, qty, unit_price_minor, created_at)
      select oid, iid, ol.id, ol.qty, ol.unit_price_minor, o.odate + 2 + time '12:00' from public.sal_order_lines ol where ol.order_id = sid;
      select sum(round(qty * unit_price_minor)) into v_total from public.sal_order_lines where order_id = sid;
      v_age := current_date - (o.odate + 2);
      h := abs(hashtext('p' || o.n)) % 100;
      if o.cust = 7 then h := h + 25; end if;                         -- one slow-paying customer
      v_paid := case when v_age > 45 then case when h < 82 then v_total when h < 92 then round(v_total * 0.6) else 0 end
                     else case when h < 40 then v_total else 0 end end;
      if v_paid > 0 and (o.odate + 2 + 10 + h % 30) <= current_date then
        v_pay := v_pay + 1;
        insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, created_by, created_at)
        values (oid, 'PAY-' || lpad(v_pay::text, 4, '0'), 'in', v_paid, 'EGP', o.odate + 2 + 10 + h % 30, case when h % 3 = 0 then 'cash' else 'bank' end, iid, uo, o.odate + 2 + 10 + h % 30 + time '12:00');
      end if;
    end loop;

    -- (d) raw materials and packaging consumed by the production floor at the end of the month (lump sum, no recipes yet)
    for g in select distinct i.wh from t_item i where i.kind in ('raw', 'pack') and v_ms + 27 <= current_date order by 1 loop
      v_req := v_req + 1;
      insert into public.inv_requests (org_id, number, requester_id, warehouse_id, reason, status, decided_by, decided_at, created_at, updated_at)
      values (oid, 'OUT-' || lpad(v_req::text, 4, '0'), ur, (select id from t_wh where code = g.wh), 'Production floor, ' || to_char(v_ms, 'YYYY-MM') || ' (lump sum, no recipes yet)', 'approved', um, v_ms + 26 + time '09:00', v_ms + 25 + time '16:00', v_ms + 26 + time '09:00')
      returning id into rid;
      insert into public.inv_approvals (org_id, request_id, decision, approver_id, channel, decided_at) values (oid, rid, 'approved', um, 'app', v_ms + 26 + time '09:00');
      insert into public.inv_request_lines (org_id, request_id, item_id, qty, created_at)
      select oid, rid, i.id, case when i.kind = 'raw' then round(units * i.inten, 3) else ceil(units * i.inten) end, v_ms + 25 + time '16:00'
        from t_item i where i.wh = g.wh and i.kind in ('raw', 'pack') and units * i.inten > 0;
      insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, request_id, ref, posted_by, posted_at)
      select oid, l2.item_id, (select id from t_wh where code = g.wh), -l2.qty, 'issue', rid, 'Production ' || to_char(v_ms, 'YYYY-MM'), ur, v_ms + 27 + time '10:00'
        from public.inv_request_lines l2 join public.inv_items it on it.id = l2.item_id where l2.request_id = rid order by it.sku;
      update public.inv_requests set status = 'issued', issued_by = ur, issued_at = v_ms + 27 + time '10:00' where id = rid;
    end loop;

    -- (e) expenses of the month, paid by bank (the latest month's electricity is still unpaid)
    for r in select * from (values ('Rent', 8500000, 1), ('Salaries', 42000000 + (m * 17000), 2), ('Electricity and water', 3800000 + (abs(hashtext('e' || v_ms)) % 900000), 5),
                                   ('Transport', 2200000 + (abs(hashtext('t' || v_ms)) % 600000), 8), ('Marketing', 1500000 + (abs(hashtext('m' || v_ms)) % 2500000), 10),
                                   ('Maintenance', case when m % 4 = 0 then 1800000 else 0 end, 12)) v(cat, amt, day) where amt > 0 and v_ms + day <= current_date loop
      v_exp := v_exp + 1;
      select id into v_catid from public.fin_categories where org_id = oid and name = r.cat;
      insert into public.fin_expenses (org_id, number, expense_date, category_id, supplier_id, amount_minor, currency, note, created_by, created_at)
      values (oid, 'EXP-' || lpad(v_exp::text, 4, '0'), v_ms + r.day, v_catid, case r.cat when 'Transport' then (select id from t_sup where idx = 8) when 'Electricity and water' then (select id from t_sup where idx = 11) end,
              r.amt::bigint, 'EGP', r.cat || ' ' || to_char(v_ms, 'YYYY-MM') || ' (sample)', uo, v_ms + r.day + time '09:00') returning id into v_exid;
      if v_ms + r.day + 1 <= current_date and not (m = 1 and r.cat = 'Electricity and water') then
        v_pay := v_pay + 1;
        insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, expense_id, created_by, created_at)
        values (oid, 'PAY-' || lpad(v_pay::text, 4, '0'), 'out', r.amt::bigint, 'EGP', v_ms + r.day + 1, 'bank', v_exid, uo, v_ms + r.day + 1 + time '12:00');
      end if;
    end loop;

    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (oid, uo, 'demo.topup', 'organization', to_char(v_ms, 'YYYY-MM'), 'Sample data topped up for ' || to_char(v_ms, 'YYYY-MM') || ' (written directly, no per-row audit entries)');
  end loop;

  update public.inv_batches set status = 'available' where org_id = oid and batch_no like 'NEAR-%';
  alter table public.inv_requests enable trigger inv_requests_notify;

  -- ------------------------------------------------------------ balances follow the ledger; counters continue
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved)
  select oid, s.item_id, s.warehouse_id, 0, 0 from public.inv_stock_moves s where s.org_id = oid group by s.item_id, s.warehouse_id
  on conflict (org_id, item_id, warehouse_id) do nothing;
  update public.inv_stock_balances b set on_hand = coalesce((select sum(s.qty) from public.inv_stock_moves s where s.org_id = oid and s.item_id = b.item_id and s.warehouse_id = b.warehouse_id), 0) where b.org_id = oid;
  select coalesce(max(n), v_so) into v_so from t_orders;
  insert into public.inv_counters (org_id, key, value) values (oid, 'request', v_req), (oid, 'sales_order', v_so), (oid, 'sales_invoice', v_inv), (oid, 'payment', v_pay), (oid, 'expense', v_exp), (oid, 'purchase_order', v_po)
  on conflict (org_id, key) do update set value = greatest(public.inv_counters.value, excluded.value);

  select min(x) into v_first from unnest(string_to_array(replace(v_new, ' ', ''), ',')) x;
  v_msg := format('months added: %s | sales orders %s, revenue %s EGP, purchase orders %s, expenses %s EGP, payments %s | ledger rows %s | stock rows below zero or under their reservation: %s',
    coalesce(nullif(v_new, ''), 'none'),
    (select count(*) from public.sal_invoices where org_id = oid and invoice_date >= to_date(coalesce(v_first, '2100-01') || '-01', 'YYYY-MM-DD')),
    (select coalesce(round(sum(il.qty * il.unit_price_minor)) / 100, 0) from public.sal_invoice_lines il join public.sal_invoices i on i.id = il.invoice_id where i.org_id = oid and i.invoice_date >= to_date(coalesce(v_first, '2100-01') || '-01', 'YYYY-MM-DD')),
    (select count(*) from public.pur_orders where org_id = oid and created_at >= to_date(coalesce(v_first, '2100-01') || '-01', 'YYYY-MM-DD')),
    (select coalesce(sum(amount_minor) / 100, 0) from public.fin_expenses where org_id = oid and expense_date >= to_date(coalesce(v_first, '2100-01') || '-01', 'YYYY-MM-DD')),
    (select count(*) from public.fin_payments where org_id = oid and paid_on >= to_date(coalesce(v_first, '2100-01') || '-01', 'YYYY-MM-DD')),
    (select count(*) from public.inv_stock_moves where org_id = oid and posted_at >= to_date(coalesce(v_first, '2100-01') || '-01', 'YYYY-MM-DD')),
    (select count(*) from public.inv_stock_balances where org_id = oid and (on_hand < 0 or reserved > on_hand)));
  if v_dry then raise exception 'DRY RUN, everything rolled back: %', v_msg; end if;
  raise notice 'TOP-UP DONE: %', v_msg;
end $$;

-- Verification (read-only): invoices per month for the sample organization (the last months should now have data).
select to_char(date_trunc('month', i.invoice_date), 'YYYY-MM') as month, count(*) as invoices
  from public.sal_invoices i join public.organizations o on o.id = i.org_id where o.slug = 'demo-cosmetics'
 group by 1 order by 1 desc limit 4;
