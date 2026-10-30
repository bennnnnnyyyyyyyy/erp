-- sql/seed/004_cosmetics_factory_demo.sql
-- DEMO DATA, not a migration. Organization "Demo Cosmetics Factory (sample data)": an INVENTED cosmetics manufacturer in Egypt,
-- with 12 months of history so the home page, profit and forecast have something to show. Every name is made up (suppliers and
-- customers are marked "(sample)"); no real company, person, phone, tax number or address. Arabic item names are a machine
-- draft and need a native speaker.
--
-- Owner chris.johnson.wiz@gmail.com, admin joseph.brown.wiz@gmail.com, member grant.holden.wiz@gmail.com (existing users;
-- nothing here creates users or passwords). Currency EGP, Africa/Cairo. Needs sql/001-026. Safe to rerun: does nothing if the
-- organization exists. Never deletes anything and never touches another organization.
--
-- HOW IT IS WRITTEN (be honest about it): history is inserted directly with back-dated times (the app's functions always stamp
-- "now"), so the seeded history has NO audit-log rows of its own (one summary row is written). The ledger, batches, approvals,
-- invoices and payments follow the same rules the app enforces. Deterministic: pseudo-random numbers come from hashes, so a rerun
-- on a fresh database gives the same pattern (ids and dates relative to today differ). All approvals use channel 'app': no
-- WhatsApp delivery is faked. There is no manufacturing module yet, so finished goods are "received from production" and raw
-- materials and packaging are "issued to the production floor" in monthly lump sums: profit from this data is approximate.
--
-- Run: supabase db query --linked -f sql/seed/004_cosmetics_factory_demo.sql

do $$
declare
  uo uuid; um uuid; ur uuid; oid uuid;
  c_amb uuid; c_cold uuid;
  v_req int := 0; v_pay int := 0; v_exp int := 0; v_inv int := 0; v_po int := 0; v_so int := 0;
  m int; v_ms date; d numeric; units numeric;
  r record; o record; l record; g record;
  rid uuid; sid uuid; iid uuid; pid uuid; bid uuid; poid uuid; siid uuid; pol uuid;
  v_total bigint; v_paid bigint; v_cost bigint; v_qty numeric; v_recv date; v_age int; h int; v_catid uuid; v_exid uuid;
begin
  select id into uo from auth.users where lower(email) = 'chris.johnson.wiz@gmail.com';
  select id into um from auth.users where lower(email) = 'joseph.brown.wiz@gmail.com';
  select id into ur from auth.users where lower(email) = 'grant.holden.wiz@gmail.com';
  if uo is null or um is null or ur is null then raise exception 'Create the three demo users first'; end if;
  if exists (select 1 from public.organizations where slug = 'demo-cosmetics') then raise notice 'already exists, nothing to do'; return; end if;

  -- The history is inserted directly; without this, the approval-request trigger would queue a "needs your approval" message for every
  -- one of the ~600 historical requests (it did, once; they were cancelled by hand). Re-enabled at the end, same transaction.
  alter table public.inv_requests disable trigger inv_requests_notify;

  oid := public.bootstrap_organization('Demo Cosmetics Factory (sample data)', 'demo-cosmetics', 'chris.johnson.wiz@gmail.com');
  update public.organizations set default_currency = 'EGP', timezone = 'Africa/Cairo' where id = oid;
  insert into public.memberships (org_id, user_id, role, invited_by) values (oid, um, 'admin', uo), (oid, ur, 'member', uo) on conflict do nothing;
  perform public.core_enable_all_modules(oid);

  -- ------------------------------------------------------------ places and conditions
  insert into public.inv_storage_conditions (org_id, name, min_temp_c, max_temp_c) values (oid, 'Ambient', 15, 25), (oid, 'Cold room', 2, 8);
  select id into c_amb from public.inv_storage_conditions where org_id = oid and name = 'Ambient';
  select id into c_cold from public.inv_storage_conditions where org_id = oid and name = 'Cold room';
  create temp table t_wh (code text primary key, id uuid) on commit drop;
  with w as (
    insert into public.inv_warehouses (org_id, code, name, name_ar, storage_condition_id) values
      (oid, 'RAW',  'Raw materials',     'المواد الخام', c_amb),
      (oid, 'PACK', 'Packaging',         'مواد التعبئة', c_amb),
      (oid, 'COLD', 'Cold room',         'غرفة التبريد', c_cold),
      (oid, 'FG',   'Finished goods',    'المنتجات الجاهزة', c_amb),
      (oid, 'QRN',  'Quarantine',        'الحجر', c_amb) returning code, id)
  insert into t_wh select code, id from w;

  -- ------------------------------------------------------------ items (kind: raw / pack / fg). cost and price in piasters.
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
  with ins as (
    insert into public.inv_items (org_id, sku, name, name_ar, uom, avg_cost_minor, tracks_batches, storage_condition_id)
    select oid, sku, name, name_ar, uom, cost, kind <> 'pack', case when wh = 'COLD' then c_cold else c_amb end from t_def returning id, sku)
  insert into t_item select i.sku, i.id, d.kind, d.cost, d.price, d.wh, d.sup, d.shelf, d.cat, d.inten,
                            case when d.kind = 'fg' then row_number() over (partition by d.kind order by d.sku)::int end
  from ins i join t_def d on d.sku = i.sku;

  -- ------------------------------------------------------------ suppliers and customers (invented)
  create temp table t_sup (idx int primary key, id uuid) on commit drop;
  with s as (
    insert into public.pur_suppliers (org_id, name, contact, city) values
      (oid,'Delta Chemical Trading (sample)','Purchasing desk','Cairo'),
      (oid,'Nile Naturals Oils (sample)','Sales desk','Giza'),
      (oid,'Cairo Actives Import (sample)','Account manager','Cairo'),
      (oid,'Alexandria Minerals (sample)','Sales desk','Alexandria'),
      (oid,'Giza Additives (sample)','Sales desk','Giza'),
      (oid,'Cairo Fragrance Imports (sample)','Account manager','Cairo'),
      (oid,'Suez Surfactants (sample)','Sales desk','Suez'),
      (oid,'Upper Egypt Transport (sample)','Dispatcher','Assiut'),
      (oid,'Delta Plastics (sample)','Sales desk','Tanta'),
      (oid,'Mahalla Cartons (sample)','Sales desk','Mahalla'),
      (oid,'Ismailia Utilities (sample)','Billing','Ismailia'),
      (oid,'Alex Label Printing (sample)','Sales desk','Alexandria') returning id, name)
  insert into t_sup select case name
      when 'Delta Chemical Trading (sample)' then 1 when 'Nile Naturals Oils (sample)' then 2 when 'Cairo Actives Import (sample)' then 3
      when 'Alexandria Minerals (sample)' then 4 when 'Giza Additives (sample)' then 5 when 'Cairo Fragrance Imports (sample)' then 6
      when 'Suez Surfactants (sample)' then 7 when 'Upper Egypt Transport (sample)' then 8 when 'Delta Plastics (sample)' then 9
      when 'Mahalla Cartons (sample)' then 10 when 'Ismailia Utilities (sample)' then 11 else 12 end, id from s;

  create temp table t_cust (idx int primary key, id uuid, scale numeric, discount numeric) on commit drop;
  with c as (
    insert into public.sal_customers (org_id, name, contact, city) values
      (oid,'Cairo Pharmacy Chain (sample)','Buying office','Cairo'),(oid,'Delta Supermarkets Distribution (sample)','Buying office','Mansoura'),
      (oid,'Alexandria Beauty Stores (sample)','Owner','Alexandria'),(oid,'Gulf Export Buyer (sample)','Export desk','Cairo'),
      (oid,'Online Beauty Shop (sample)','Owner','Giza'),(oid,'Upper Egypt Wholesale (sample)','Owner','Assiut'),
      (oid,'Maadi Care Centers (sample)','Buying office','Cairo'),(oid,'Nasr City Cosmetics (sample)','Owner','Cairo'),
      (oid,'Port Said Trading (sample)','Owner','Port Said'),(oid,'Hospital Supply Group (sample)','Buying office','Cairo') returning id, name)
  insert into t_cust select case name
      when 'Cairo Pharmacy Chain (sample)' then 1 when 'Delta Supermarkets Distribution (sample)' then 2 when 'Alexandria Beauty Stores (sample)' then 3
      when 'Gulf Export Buyer (sample)' then 4 when 'Online Beauty Shop (sample)' then 5 when 'Upper Egypt Wholesale (sample)' then 6
      when 'Maadi Care Centers (sample)' then 7 when 'Nasr City Cosmetics (sample)' then 8 when 'Port Said Trading (sample)' then 9 else 10 end,
      id, case name when 'Gulf Export Buyer (sample)' then 3.0 when 'Online Beauty Shop (sample)' then 0.5 when 'Cairo Pharmacy Chain (sample)' then 1.6 else 1.0 end,
      (abs(hashtext(name)) % 12) / 100.0 from c;

  insert into public.fin_categories (org_id, name) values (oid,'Rent'),(oid,'Salaries'),(oid,'Electricity and water'),(oid,'Transport'),(oid,'Marketing'),(oid,'Maintenance');

  -- ------------------------------------------------------------ the sales plan for 12 months
  create temp table t_orders (n int primary key, ms date, cust int, odate date) on commit drop;
  insert into t_orders
  select row_number() over (order by x.ms, c.idx, k)::int, x.ms, c.idx, (x.ms + (2 + abs(hashtext('d' || x.ms || c.idx || k)) % 24))::date
    from (select (date_trunc('month', current_date) - make_interval(months => mm))::date as ms from generate_series(1, 12) mm) x
    cross join t_cust c
    cross join lateral generate_series(1, 2 + abs(hashtext('n' || x.ms || c.idx)) % 2) k;
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

  -- ------------------------------------------------------------ month by month (oldest first)
  for m in reverse 12..1 loop
    v_ms := (date_trunc('month', current_date) - make_interval(months => m))::date;
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
      v_po := v_po + 1;
      v_recv := (v_ms + 1 + case when g.sup = 6 then 18 + abs(hashtext('lead' || v_ms || g.sup)) % 6 else 4 + abs(hashtext('lead' || v_ms || g.sup)) % 4 end)::date;
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
    for g in select distinct i.wh from t_item i where i.kind in ('raw', 'pack') order by 1 loop
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
                                   ('Maintenance', case when m % 4 = 0 then 1800000 else 0 end, 12)) v(cat, amt, day) where amt > 0 loop
      v_exp := v_exp + 1;
      select id into v_catid from public.fin_categories where org_id = oid and name = r.cat;
      insert into public.fin_expenses (org_id, number, expense_date, category_id, supplier_id, amount_minor, currency, note, created_by, created_at)
      values (oid, 'EXP-' || lpad(v_exp::text, 4, '0'), v_ms + r.day, v_catid, case r.cat when 'Transport' then (select id from t_sup where idx = 8) when 'Electricity and water' then (select id from t_sup where idx = 11) end,
              r.amt::bigint, 'EGP', r.cat || ' ' || to_char(v_ms, 'YYYY-MM') || ' (sample)', uo, v_ms + r.day + time '09:00') returning id into v_exid;
      if not (m = 1 and r.cat = 'Electricity and water') then
        v_pay := v_pay + 1;
        insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, expense_id, created_by, created_at)
        values (oid, 'PAY-' || lpad(v_pay::text, 4, '0'), 'out', r.amt::bigint, 'EGP', v_ms + r.day + 1, 'bank', v_exid, uo, v_ms + r.day + 1 + time '12:00');
      end if;
    end loop;
  end loop;

  -- ------------------------------------------------------------ today: near-expiry, expired and quarantined lots (finished goods)
  for r in select * from (values ('F-LIP', 300, 18, false, 'NEAR-A'), ('F-HND', 180, 42, false, 'NEAR-B'), ('F-SUN', 120, 80, false, 'NEAR-C'),
                                 ('F-SER', 40, -10, false, 'OLD-X'), ('F-MSK', 60, 200, true, 'HOLD-Q')) v(sku, q, days, quarantined, tag) loop
    select * into l from t_item where sku = r.sku;
    insert into public.inv_batches (org_id, item_id, batch_no, mfg_date, expiry_date, status, created_by)
    values (oid, l.id, r.tag || '-' || right(r.sku, 3), current_date - 400, current_date + r.days, case when r.quarantined then 'quarantined' else 'available' end, um) returning id into bid;
    perform set_config('erp.batch_id', bid::text, true);
    insert into public.inv_stock_moves (org_id, item_id, warehouse_id, qty, kind, ref, posted_by, unit_cost_minor)
    values (oid, l.id, (select id from t_wh where code = 'FG'), r.q, 'receipt', 'Older production lot (sample)', um, l.cost);
    perform set_config('erp.batch_id', '', true);
  end loop;

  alter table public.inv_requests enable trigger inv_requests_notify;

  -- ------------------------------------------------------------ open requests that need the manager today
  for r in select * from (values ('F-SHA', 120, 'submitted'), ('F-SUN', 60, 'submitted'), ('F-OIL', 48, 'submitted'), ('F-CON', 72, 'approved')) v(sku, q, st) loop
    v_req := v_req + 1;
    select * into l from t_item where sku = r.sku;
    insert into public.inv_requests (org_id, number, requester_id, warehouse_id, reason, status, decided_by, decided_at, created_at)
    values (oid, 'OUT-' || lpad(v_req::text, 4, '0'), ur, (select id from t_wh where code = 'FG'), 'Customer pickup (sample)', r.st, case when r.st = 'approved' then um end, case when r.st = 'approved' then now() end, now() - interval '3 hours') returning id into rid;
    insert into public.inv_request_lines (org_id, request_id, item_id, qty) values (oid, rid, l.id, r.q);
    if r.st = 'approved' then insert into public.inv_approvals (org_id, request_id, decision, approver_id, channel) values (oid, rid, 'approved', um, 'app'); end if;
  end loop;

  -- ------------------------------------------------------------ balances from the ledger, reorder levels, counters
  insert into public.inv_stock_balances (org_id, item_id, warehouse_id, on_hand, reserved)
  select oid, item_id, warehouse_id, sum(qty), 0 from public.inv_stock_moves where org_id = oid group by item_id, warehouse_id;
  update public.inv_stock_balances b set reserved = coalesce((select sum(l2.qty) from public.inv_request_lines l2 join public.inv_requests q on q.id = l2.request_id
      where q.org_id = oid and q.status in ('submitted', 'approved') and q.warehouse_id = b.warehouse_id and l2.item_id = b.item_id), 0) where b.org_id = oid;
  update public.inv_items i set reorder_level = ceil((select coalesce(sum(tl.qty), 0) from t_lines tl where tl.sku = i.sku) / 12.0 * 0.6) where i.org_id = oid and i.sku like 'F-%';
  update public.inv_items i set reorder_level = ceil((select coalesce(sum(b.on_hand), 0) from public.inv_stock_balances b where b.item_id = i.id) + 40) where i.org_id = oid and i.sku in ('F-OIL', 'F-SER', 'R-FR2');
  update public.inv_items i set avg_cost_minor = round(i.avg_cost_minor * 1.10) where i.org_id = oid and i.sku not like 'x%';
  insert into public.inv_counters (org_id, key, value) values (oid, 'request', v_req), (oid, 'sales_order', v_so), (oid, 'sales_invoice', v_inv), (oid, 'payment', v_pay), (oid, 'expense', v_exp), (oid, 'purchase_order', v_po)
  on conflict (org_id, key) do update set value = excluded.value;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (oid, uo, 'demo.seeded', 'organization', oid::text, 'Sample data loaded: invented cosmetics factory, 12 months of history, written directly (history rows have no individual audit entries)');
  raise notice 'seeded % requests, % sales orders, % purchase orders, % payments, % expenses', v_req, v_so, v_po, v_pay, v_exp;
end $$;

-- Verification (read-only): counts for the demo organization.
select (select count(*) from public.inv_items i join public.organizations o on o.id = i.org_id where o.slug = 'demo-cosmetics') as items,
       (select count(*) from public.sal_orders s join public.organizations o on o.id = s.org_id where o.slug = 'demo-cosmetics') as sales_orders,
       (select count(*) from public.inv_stock_moves s join public.organizations o on o.id = s.org_id where o.slug = 'demo-cosmetics') as ledger_rows;
