-- sql/070_core_report_links.sql
-- Private read-only report links that Google Sheets can read ("option C", documentation/planning/2026-11-09-google-sheets-options.md, decision 3).
-- Rerun-safe. Needs sql/001-068 (inventory sql/006, sales sql/019 and sql/022, due dates sql/041, payments sql/024).
--
-- An owner or admin makes a private link for one report; in Google Sheets someone types =IMPORTDATA("link") and the sheet refreshes by itself.
-- Only three reports exist: stock on hand, open invoices, sales by month. They hold no personal data (no phone, email or address) and never
-- the audit log. The link is a key, so: one report per link, read-only, revocable, optional expiry, last read time and read count, and
-- creating and revoking are audited in the same transaction.
-- The token (64 hex characters, 32 random bytes) is shown once when the link is made. Only its SHA-256 is stored, never the token.
-- The public read function is granted to anon (the web address has no signed-in user). It looks the token up, refuses with one and the same
-- NOT_FOUND for a missing, revoked or expired link and for a module that was switched off (nothing leaks about which), and returns only
-- the link's own company's rows. Writes go through the two security-definer functions (ADR-0003).
-- Limits (written down on purpose): "open" invoices are issued invoices whose lines minus recorded payments are above zero (the same sum
-- as fin__invoice_outstanding, sql/057); credit and debit notes are not netted. Each report is capped at 5,000 rows.

begin;

create table if not exists public.core_report_links (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  report       text not null check (report in ('stock_on_hand', 'open_invoices', 'sales_by_month')),
  label        text check (label is null or length(label) <= 100),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id),
  last_read_at timestamptz,
  read_count   bigint not null default 0,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists core_report_links_org_idx on public.core_report_links (org_id, created_at desc);

drop trigger if exists core_report_links_updated_at on public.core_report_links;
create trigger core_report_links_updated_at before update on public.core_report_links for each row execute function public.set_updated_at();

alter table public.core_report_links enable row level security;
revoke all on public.core_report_links from anon, authenticated;
grant select on public.core_report_links to authenticated;
drop policy if exists core_report_links_admin_read on public.core_report_links;
create policy core_report_links_admin_read on public.core_report_links for select to authenticated
  using (exists (select 1 from public.memberships m
    where m.org_id = core_report_links.org_id and m.user_id = (select auth.uid()) and m.disabled_at is null and m.role in ('owner', 'admin')));

-- ---------------------------------------------------------------- helper: minor units as exact decimal text

create or replace function public.core__minor_text(p_minor bigint, p_currency text) returns text
language sql immutable set search_path = public as $$
  select case when p_minor is null then '' else
    case when p_minor < 0 then '-' else '' end ||
    case d.n when 0 then abs(p_minor)::text
      else (abs(p_minor) / power(10, d.n)::bigint)::text || '.' || lpad((abs(p_minor) % power(10, d.n)::bigint)::text, d.n, '0') end
  end
  from (select case when upper(coalesce(p_currency, '')) in ('JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF') then 0
                    when upper(coalesce(p_currency, '')) in ('KWD', 'BHD', 'JOD', 'OMR', 'TND', 'LYD', 'IQD') then 3
                    else 2 end as n) d;
$$;
revoke all on function public.core__minor_text(bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- create and revoke (owners and admins, audited)

create or replace function public.core_create_report_link(p_report text, p_label text, p_expires_days int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.require_org_role(array['owner', 'admin']);
  v_mod   text;
  v_token text;
  v_id    uuid;
  v_label text := nullif(trim(coalesce(p_label, '')), '');
begin
  if p_report is null or p_report not in ('stock_on_hand', 'open_invoices', 'sales_by_month') then raise exception 'INVALID_INPUT'; end if;
  if v_label is not null and length(v_label) > 100 then raise exception 'INVALID_INPUT'; end if;
  if p_expires_days is not null and p_expires_days not between 1 and 3650 then raise exception 'INVALID_INPUT'; end if;
  v_mod := case p_report when 'stock_on_hand' then 'inventory' else 'sales' end;
  if not exists (select 1 from public.org_modules m where m.org_id = v_org and m.module_key = v_mod and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.core_report_links (org_id, report, label, token_hash, created_by, expires_at)
  values (v_org, p_report, v_label, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(),
          case when p_expires_days is null then null else now() + make_interval(days => p_expires_days) end)
  returning id into v_id;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.report_link.created', 'report_link', v_id::text,
          format('Private link created for %s%s', p_report, case when v_label is null then '' else ' (' || v_label || ')' end));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.core_revoke_report_link(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
  l public.core_report_links;
begin
  select * into l from public.core_report_links where id = p_id and org_id = v_org and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.revoked_at is not null then return; end if;   -- already revoked: nothing changes, no second audit row
  update public.core_report_links set revoked_at = now(), revoked_by = auth.uid() where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.report_link.revoked', 'report_link', l.id::text,
          format('Private link for %s revoked%s', l.report, case when l.label is null then '' else ' (' || l.label || ')' end));
end $$;

-- ---------------------------------------------------------------- the public read (granted to anon; the token is the only credential)

create or replace function public.core_report_link_rows(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l       public.core_report_links;
  v_mod   text;
  v_cols  jsonb;
  v_rows  jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND'; end if;
  select * into l from public.core_report_links where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and deleted_at is null for update;
  if not found or l.revoked_at is not null or (l.expires_at is not null and l.expires_at <= now()) then raise exception 'NOT_FOUND'; end if;
  v_mod := case l.report when 'stock_on_hand' then 'inventory' else 'sales' end;
  if not exists (select 1 from public.org_modules m where m.org_id = l.org_id and m.module_key = v_mod and m.disabled_at is null) then
    raise exception 'NOT_FOUND';
  end if;

  if l.report = 'stock_on_hand' then
    v_cols := '["Item code","Item name","Warehouse","Quantity","Unit"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_array(s.sku, s.item_name, s.warehouse, s.qty, s.uom) order by s.sku, s.warehouse), '[]'::jsonb) into v_rows
    from (select i.sku, i.name as item_name, w.name as warehouse, trim_scale(b.on_hand)::text as qty, i.uom
          from public.inv_stock_balances b
          join public.inv_items i on i.org_id = b.org_id and i.id = b.item_id and i.deleted_at is null
          join public.inv_warehouses w on w.org_id = b.org_id and w.id = b.warehouse_id and w.deleted_at is null
          where b.org_id = l.org_id and b.on_hand > 0
          order by i.sku, w.name limit 5000) s;
  elsif l.report = 'open_invoices' then
    v_cols := '["Number","Date","Due date","Customer","Currency","Total","Paid","Left"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_array(s.number, s.invoice_date, s.due_date, s.customer, s.currency,
             public.core__minor_text(s.total, s.currency), public.core__minor_text(s.paid, s.currency), public.core__minor_text(s.total - s.paid, s.currency))
             order by s.due_date, s.number), '[]'::jsonb) into v_rows
    from (select v.number, v.invoice_date, v.due_date, c.name as customer, v.currency::text as currency, v.total, v.paid
          from (select inv.number, inv.invoice_date, inv.due_date, inv.customer_id, inv.currency,
                       coalesce((select sum(round(ln.qty * ln.unit_price_minor)) from public.sal_invoice_lines ln where ln.org_id = inv.org_id and ln.invoice_id = inv.id), 0)::bigint as total,
                       coalesce((select sum(p.amount_minor) from public.fin_payments p where p.org_id = inv.org_id and p.customer_invoice_id = inv.id and p.status = 'recorded'), 0)::bigint as paid
                from public.sal_invoices inv where inv.org_id = l.org_id and inv.status = 'issued') v
          join public.sal_customers c on c.org_id = l.org_id and c.id = v.customer_id
          where v.total - v.paid > 0
          order by v.due_date, v.number limit 5000) s;
  else
    v_cols := '["Month","Currency","Invoices","Total"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_array(s.month, s.currency, s.n, public.core__minor_text(s.total, s.currency)) order by s.month, s.currency), '[]'::jsonb) into v_rows
    from (select to_char(v.invoice_date, 'YYYY-MM') as month, v.currency::text as currency, count(*) as n, sum(v.total)::bigint as total
          from (select inv.invoice_date, inv.currency,
                       coalesce((select sum(round(ln.qty * ln.unit_price_minor)) from public.sal_invoice_lines ln where ln.org_id = inv.org_id and ln.invoice_id = inv.id), 0)::bigint as total
                from public.sal_invoices inv where inv.org_id = l.org_id and inv.status = 'issued') v
          group by 1, 2 order by 1, 2 limit 5000) s;
  end if;

  update public.core_report_links set last_read_at = now(), read_count = read_count + 1 where id = l.id;
  return jsonb_build_object('report', l.report, 'columns', v_cols, 'rows', v_rows);
end $$;

revoke all on function public.core_create_report_link(text, text, int), public.core_revoke_report_link(uuid), public.core_report_link_rows(text) from public, anon, authenticated;
grant execute on function public.core_create_report_link(text, text, int), public.core_revoke_report_link(uuid) to authenticated;
grant execute on function public.core_report_link_rows(text) to anon, authenticated;

commit;

-- Verification (read-only): the table has row level security; anon cannot read it; only the public read is open to anon; the rest need a sign-in.
select (select relrowsecurity from pg_class where oid = 'public.core_report_links'::regclass) as rls_on,
       has_table_privilege('anon', 'public.core_report_links', 'select') as anon_can_read_table,
       has_table_privilege('authenticated', 'public.core_report_links', 'insert') as users_can_write_table,
       has_function_privilege('anon', 'public.core_report_link_rows(text)', 'execute') as anon_can_read_report,
       has_function_privilege('anon', 'public.core_create_report_link(text, text, int)', 'execute') as anon_can_create,
       has_function_privilege('authenticated', 'public.core_create_report_link(text, text, int)', 'execute') as users_can_create;
