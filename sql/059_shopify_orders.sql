-- sql/059_shopify_orders.sql
-- Shopify orders in (documentation/planning/INTEGRATION_PROVIDER_CHOICES.md). Rerun-safe. Needs sql/001-058.
--
-- * A signed Shopify webhook (checked by the server with the company's API secret) becomes ONE open sales order, once per Shopify
--   order. Lines are matched by SKU. If anything does not match (unknown SKU, different currency, the same SKU at two prices, empty
--   order) nothing is created: the order is kept in sal_shopify_orders as 'review' with the reason, for a person.
-- * The sales order starts 'open'. Stock still leaves only through the normal approved request: nothing here moves stock.
-- * The customer is found by phone (or created from the Shopify name); the warehouse is the optional "warehouse_code" setting, else
--   the oldest active warehouse. The order is attributed to whoever last saved the Shopify settings.
-- * Simulated mode: a test order for the first item in the catalogue, so the flow can be tried with no Shopify account.

begin;

-- sql/056's field list plus the optional warehouse code for Shopify orders.
create or replace function public.core__provider_fields(p_kind text)
returns table (field text, is_secret boolean, required boolean)
language sql immutable as $$
  select v.field, v.is_secret, v.required from (values
    ('paymob', 'secret_key', true, true), ('paymob', 'public_key', true, true), ('paymob', 'hmac_secret', true, true),
    ('paymob', 'integration_ids', false, true),
    ('fawry', 'merchant_code', false, true), ('fawry', 'secure_key', true, true),
    ('bosta', 'api_key', true, true), ('bosta', 'webhook_secret', true, true),
    ('shopify', 'shop_domain', false, true), ('shopify', 'access_token', true, true), ('shopify', 'webhook_secret', true, true),
    ('shopify', 'warehouse_code', false, false),
    ('openai', 'api_key', true, false), ('openai', 'model', false, false),
    ('elevenlabs', 'api_key', true, false),
    ('ollama', 'base_url', false, true), ('ollama', 'model', false, true), ('ollama', 'api_key', true, false)
  ) v(kind, field, is_secret, required) where v.kind = p_kind;
$$;

create table if not exists public.sal_shopify_orders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  shopify_order_id text not null check (length(shopify_order_id) between 1 and 40),
  shopify_name     text,
  status           text not null check (status in ('imported', 'review')),
  review_reason    text,
  sales_order_id   uuid,
  simulated        boolean not null default false,
  total_minor      bigint,
  currency         char(3),
  webhook_id       text,
  created_at       timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, shopify_order_id),
  foreign key (org_id, sales_order_id) references public.sal_orders(org_id, id)
);
alter table public.sal_shopify_orders enable row level security;
revoke all on public.sal_shopify_orders from anon, authenticated;
grant select on public.sal_shopify_orders to authenticated;
drop policy if exists sal_shopify_orders_admin_read on public.sal_shopify_orders;
create policy sal_shopify_orders_admin_read on public.sal_shopify_orders for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = sal_shopify_orders.org_id and m.user_id = (select auth.uid())
                  and m.disabled_at is null and m.role in ('owner', 'admin')));

-- The server finds the company and its secret from the shop domain on the webhook (before the signature can be checked).
create or replace function public.sal__shopify_callback_credentials(p_shop text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('orgId', i.org_id, 'simulated', i.mode = 'simulated', 'enabled', i.enabled,
                            'credentials', public.core__provider_credentials(i.org_id, 'shopify'))
    from public.core_integrations i
   where i.kind = 'shopify' and lower(i.settings -> 'config' ->> 'shop_domain') = lower(p_shop)
   limit 1;
$$;

-- Turn one Shopify order into one open sales order, or hold it for review. Service role only; idempotent per Shopify order.
create or replace function public.sal__ingest_shopify_order(p_org uuid, p_order jsonb, p_webhook_id text default null, p_simulated boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_int public.core_integrations; v_sid text := p_order ->> 'id'; v_name text := p_order ->> 'name'; v_cur char(3); v_org_cur char(3);
  v_wh uuid; v_cust uuid; v_phone text; v_cname text; v_so uuid; v_no text; v_reason text; v_total bigint := 0; l record; v_item uuid; v_missing text[] := '{}';
  v_user uuid; v_lines int := 0;
begin
  if v_sid is null or length(v_sid) = 0 or jsonb_typeof(p_order -> 'line_items') <> 'array' then return jsonb_build_object('result', 'invalid'); end if;
  select * into v_int from public.core_integrations where org_id = p_org and kind = 'shopify';
  if v_int.id is null or not v_int.enabled then return jsonb_build_object('result', 'off'); end if;
  if (v_int.mode = 'simulated') is distinct from coalesce(p_simulated, false) then return jsonb_build_object('result', 'mode_mismatch'); end if;
  if exists (select 1 from public.sal_shopify_orders where org_id = p_org and shopify_order_id = v_sid) then return jsonb_build_object('result', 'duplicate'); end if;
  v_user := v_int.updated_by;
  select default_currency into v_org_cur from public.organizations where id = p_org;
  v_cur := upper(coalesce(p_order ->> 'currency', v_org_cur));

  -- every check first; a single problem holds the whole order
  if v_cur is distinct from v_org_cur then v_reason := format('the order is in %s but the company currency is %s', v_cur, v_org_cur); end if;
  if v_reason is null then
    for l in select coalesce(nullif(trim(e ->> 'sku'), ''), '') as sku, sum((e ->> 'quantity')::numeric) as qty,
                    count(distinct (e ->> 'price')) as prices, min(round((e ->> 'price')::numeric * 100)::bigint) as price_minor
               from jsonb_array_elements(p_order -> 'line_items') e group by 1 loop
      v_lines := v_lines + 1;
      select id into v_item from public.inv_items where org_id = p_org and lower(sku) = lower(l.sku) and deleted_at is null;
      if l.sku = '' or v_item is null then v_missing := v_missing || coalesce(nullif(l.sku, ''), '(no SKU)');
      elsif l.prices > 1 then v_reason := format('the SKU %s appears at two different prices', l.sku);
      elsif l.qty <= 0 then v_reason := format('the SKU %s has no quantity', l.sku); end if;
    end loop;
    if v_lines = 0 then v_reason := 'the order has no lines'; end if;
    if v_reason is null and array_length(v_missing, 1) > 0 then v_reason := 'no item with SKU ' || array_to_string(v_missing, ', '); end if;
  end if;
  if v_reason is null and v_user is null then v_reason := 'no user to attribute the order to: save the Shopify settings again'; end if;

  if v_reason is not null then
    insert into public.sal_shopify_orders (org_id, shopify_order_id, shopify_name, status, review_reason, simulated, currency, webhook_id)
    values (p_org, v_sid, v_name, 'review', v_reason, coalesce(p_simulated, false), v_cur, p_webhook_id);
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
    values (p_org, v_user, 'sales.shopify.review', 'shopify_order', v_sid, format('Shopify order %s held for review: %s', coalesce(v_name, v_sid), v_reason));
    return jsonb_build_object('result', 'review', 'reason', v_reason);
  end if;

  -- warehouse and customer
  select id into v_wh from public.inv_warehouses where org_id = p_org and deleted_at is null and lower(code) = lower(coalesce(v_int.settings -> 'config' ->> 'warehouse_code', ''));
  if v_wh is null then select id into v_wh from public.inv_warehouses where org_id = p_org and deleted_at is null order by created_at limit 1; end if;
  if v_wh is null then
    insert into public.sal_shopify_orders (org_id, shopify_order_id, shopify_name, status, review_reason, simulated, currency, webhook_id)
    values (p_org, v_sid, v_name, 'review', 'the company has no warehouse', coalesce(p_simulated, false), v_cur, p_webhook_id);
    return jsonb_build_object('result', 'review', 'reason', 'the company has no warehouse');
  end if;
  v_phone := nullif(trim(coalesce(p_order -> 'customer' ->> 'phone', p_order -> 'shipping_address' ->> 'phone', '')), '');
  v_cname := nullif(trim(coalesce(p_order -> 'customer' ->> 'first_name', '') || ' ' || coalesce(p_order -> 'customer' ->> 'last_name', '')), '');
  if v_phone is not null then select id into v_cust from public.sal_customers where org_id = p_org and phone = v_phone and deleted_at is null order by created_at limit 1; end if;
  if v_cust is null then
    insert into public.sal_customers (org_id, name, contact, city, phone)
    values (p_org, left(coalesce(v_cname, 'Shopify customer ' || coalesce(v_name, v_sid)), 200), nullif(p_order -> 'customer' ->> 'email', ''),
            nullif(p_order -> 'shipping_address' ->> 'city', ''), v_phone)
    on conflict do nothing returning id into v_cust;
    if v_cust is null then
      select id into v_cust from public.sal_customers where org_id = p_org and lower(name) = lower(left(coalesce(v_cname, 'Shopify customer ' || coalesce(v_name, v_sid)), 200)) and deleted_at is null limit 1;
    end if;
  end if;

  v_no := public.sal__next_number(p_org);
  insert into public.sal_orders (org_id, number, customer_id, warehouse_id, currency, created_by) values (p_org, v_no, v_cust, v_wh, v_cur, v_user) returning id into v_so;
  for l in select lower(trim(e ->> 'sku')) as sku, sum((e ->> 'quantity')::numeric) as qty, min(round((e ->> 'price')::numeric * 100)::bigint) as price_minor
             from jsonb_array_elements(p_order -> 'line_items') e group by 1 loop
    select id into v_item from public.inv_items where org_id = p_org and lower(sku) = l.sku and deleted_at is null;
    insert into public.sal_order_lines (org_id, order_id, item_id, qty, unit_price_minor) values (p_org, v_so, v_item, l.qty, l.price_minor);
    v_total := v_total + round(l.qty * l.price_minor)::bigint;
  end loop;
  insert into public.sal_shopify_orders (org_id, shopify_order_id, shopify_name, status, sales_order_id, simulated, total_minor, currency, webhook_id)
  values (p_org, v_sid, v_name, 'imported', v_so, coalesce(p_simulated, false), v_total, v_cur, p_webhook_id);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (p_org, v_user, 'sales.shopify.imported', 'sales_order', v_so::text,
          format('%s created from Shopify order %s (%s lines, %s minor units %s)%s', v_no, coalesce(v_name, v_sid), v_lines, v_total, v_cur, case when p_simulated then ' (simulated)' else '' end));
  return jsonb_build_object('result', 'imported', 'orderNumber', v_no, 'salesOrderId', v_so);
end $$;

-- Try it without Shopify: a test order for the first active item. Owner or admin, simulated mode only.
create or replace function public.sal_shopify_test_order() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); v_int public.core_integrations; i public.inv_items; v_cur char(3);
begin
  select * into v_int from public.core_integrations where org_id = v_org and kind = 'shopify';
  if v_int.id is null or not v_int.enabled or v_int.mode <> 'simulated' then raise exception 'INVALID_STATE' using detail = 'switch Shopify on in simulated mode first'; end if;
  select * into i from public.inv_items where org_id = v_org and deleted_at is null order by created_at limit 1;
  if not found then raise exception 'INVALID_STATE' using detail = 'add an item first'; end if;
  select default_currency into v_cur from public.organizations where id = v_org;
  update public.core_integrations set updated_by = auth.uid() where id = v_int.id and updated_by is null;
  return public.sal__ingest_shopify_order(v_org, jsonb_build_object(
    'id', 'SIM-' || replace(gen_random_uuid()::text, '-', ''), 'name', '#TEST', 'currency', v_cur,
    'customer', jsonb_build_object('first_name', 'Test', 'last_name', 'Shopper', 'phone', '01000000000'),
    'shipping_address', jsonb_build_object('city', 'Cairo'),
    'line_items', jsonb_build_array(jsonb_build_object('sku', i.sku, 'quantity', 1, 'price', '100.00'))), null, true);
end $$;

revoke all on function public.sal__shopify_callback_credentials(text), public.sal__ingest_shopify_order(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.sal__shopify_callback_credentials(text), public.sal__ingest_shopify_order(uuid, jsonb, text, boolean) to service_role;
revoke all on function public.sal_shopify_test_order() from public, anon;
grant execute on function public.sal_shopify_test_order() to authenticated;
revoke all on function public.core__provider_fields(text) from public, anon, authenticated;

commit;

-- Verification (read-only).
select relname, relrowsecurity from pg_class where relname = 'sal_shopify_orders';
select has_function_privilege('authenticated', 'public.sal__ingest_shopify_order(uuid, jsonb, text, boolean)', 'execute') as users_ingest,
       has_function_privilege('anon', 'public.sal_shopify_test_order()', 'execute') as anon_tests;
