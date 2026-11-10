-- sql/081_sal_customer_details.sql
-- More about a customer (walkthrough round 2, Ben 10 Nov 2026: customers get the same details as suppliers, sql/076). Rerun-safe.
-- Needs sql/001-079.
--
-- New optional fields on sal_customers: tax registration number, commercial registry number, email, address, bank name, bank account or
-- IBAN, default currency (ISO 4217) and notes. All nullable, with length checks. sal_create_customer and sal_update_customer gain the same
-- optional parameters at the end (old positional calls keep working: the new ones default to empty). The old signatures are dropped so a
-- call cannot be ambiguous. Every change is audited; an update writes the old and the new values. These are business details of companies:
-- they are never part of a public report link (sql/070 reads its own fixed columns).
-- The e-invoicing fields of sql/036 (tax_id, street, ...) are separate and untouched: they are what goes to the tax authority.

begin;

alter table public.sal_customers
  add column if not exists tax_number text,
  add column if not exists commercial_registry text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists bank_name text,
  add column if not exists bank_account text,
  add column if not exists default_currency char(3),
  add column if not exists notes text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sal_customers_details_chk') then
    alter table public.sal_customers add constraint sal_customers_details_chk check (
      (tax_number is null or length(tax_number) between 1 and 40)
      and (commercial_registry is null or length(commercial_registry) between 1 and 40)
      and (email is null or length(email) between 3 and 200)
      and (address is null or length(address) between 1 and 500)
      and (bank_name is null or length(bank_name) between 1 and 120)
      and (bank_account is null or length(bank_account) between 1 and 60)
      and (default_currency is null or default_currency ~ '^[A-Z]{3}$')
      and (notes is null or length(notes) between 1 and 2000));
  end if;
end $$;

-- the shared reading of the optional details: trimmed, empty means none, and a value that is too long or not valid is refused
create or replace function public.sal__clean_details(p_tax text, p_cr text, p_email text, p_address text, p_bank text, p_account text, p_currency text, p_notes text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v jsonb;
begin
  v := jsonb_build_object(
    'tax_number', nullif(trim(coalesce(p_tax, '')), ''), 'commercial_registry', nullif(trim(coalesce(p_cr, '')), ''),
    'email', nullif(trim(coalesce(p_email, '')), ''), 'address', nullif(trim(coalesce(p_address, '')), ''),
    'bank_name', nullif(trim(coalesce(p_bank, '')), ''), 'bank_account', nullif(trim(coalesce(p_account, '')), ''),
    'default_currency', nullif(upper(trim(coalesce(p_currency, ''))), ''), 'notes', nullif(trim(coalesce(p_notes, '')), ''));
  if length(coalesce(v ->> 'tax_number', '')) > 40 or length(coalesce(v ->> 'commercial_registry', '')) > 40 or length(coalesce(v ->> 'email', '')) > 200
     or length(coalesce(v ->> 'address', '')) > 500 or length(coalesce(v ->> 'bank_name', '')) > 120 or length(coalesce(v ->> 'bank_account', '')) > 60
     or length(coalesce(v ->> 'notes', '')) > 2000 then
    raise exception 'INVALID_INPUT' using detail = 'a customer detail is too long';
  end if;
  if v ->> 'email' is not null and v ->> 'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_INPUT' using detail = 'that email address is not valid'; end if;
  if v ->> 'default_currency' is not null and v ->> 'default_currency' !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT' using detail = 'a currency is a 3-letter code'; end if;
  return v;
end $$;
revoke all on function public.sal__clean_details(text, text, text, text, text, text, text, text) from public, anon, authenticated;

-- Create: the 050 version plus the optional details at the end.
drop function if exists public.sal_create_customer(text, text, text, text, text);
create or replace function public.sal_create_customer(p_name text, p_contact text default null, p_city text default null, p_phone text default null,
  p_code text default null, p_tax_number text default null, p_commercial_registry text default null, p_email text default null,
  p_address text default null, p_bank_name text default null, p_bank_account text default null, p_default_currency text default null,
  p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); v_id uuid; v_code text := nullif(trim(coalesce(p_code, '')), ''); d jsonb;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT'; end if;
  if v_code is not null and v_code !~ '^[A-Za-z0-9-]{1,30}$' then raise exception 'INVALID_INPUT' using detail = 'a code is letters, digits and dashes, up to 30'; end if;
  if v_code is not null and exists (select 1 from public.sal_customers where org_id = v_org and upper(code) = upper(v_code) and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = format('customer code %s is already used', v_code);
  end if;
  d := public.sal__clean_details(p_tax_number, p_commercial_registry, p_email, p_address, p_bank_name, p_bank_account, p_default_currency, p_notes);
  insert into public.sal_customers (org_id, name, contact, city, phone, code, tax_number, commercial_registry, email, address, bank_name, bank_account, default_currency, notes)
  values (v_org, trim(p_name), nullif(trim(p_contact), ''), nullif(trim(p_city), ''), nullif(trim(p_phone), ''), v_code,
          d ->> 'tax_number', d ->> 'commercial_registry', d ->> 'email', d ->> 'address', d ->> 'bank_name', d ->> 'bank_account',
          d ->> 'default_currency', d ->> 'notes')
  returning id, code into v_id, v_code;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.customer.created', 'customer', v_id::text, format('%s %s', v_code, trim(p_name)));
  return v_id;
end $$;

-- Update: the 062 version plus the optional details. Anything not given is cleared, like the contact and the city.
drop function if exists public.sal_update_customer(uuid, text, text, text, text);
create or replace function public.sal_update_customer(p_customer_id uuid, p_name text, p_contact text default null, p_city text default null,
  p_phone text default null, p_tax_number text default null, p_commercial_registry text default null, p_email text default null,
  p_address text default null, p_bank_name text default null, p_bank_account text default null, p_default_currency text default null,
  p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.sal__guard(array['owner', 'admin']); c public.sal_customers; d jsonb;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'a name is required'; end if;
  select * into c from public.sal_customers where org_id = v_org and id = p_customer_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.sal_customers where org_id = v_org and id <> c.id and lower(name) = lower(trim(p_name)) and deleted_at is null) then
    raise exception 'DUPLICATE' using detail = 'another customer already has that name';
  end if;
  d := public.sal__clean_details(p_tax_number, p_commercial_registry, p_email, p_address, p_bank_name, p_bank_account, p_default_currency, p_notes);
  update public.sal_customers
     set name = trim(p_name), contact = nullif(trim(p_contact), ''), city = nullif(trim(p_city), ''), phone = nullif(trim(p_phone), ''),
         tax_number = d ->> 'tax_number', commercial_registry = d ->> 'commercial_registry', email = d ->> 'email', address = d ->> 'address',
         bank_name = d ->> 'bank_name', bank_account = d ->> 'bank_account', default_currency = d ->> 'default_currency', notes = d ->> 'notes'
   where id = c.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'sales.customer.updated', 'customer', c.id::text, format('Customer %s %s changed', c.code, trim(p_name)),
          jsonb_build_object('name', c.name, 'contact', c.contact, 'city', c.city, 'phone', c.phone, 'tax_number', c.tax_number,
                             'commercial_registry', c.commercial_registry, 'email', c.email, 'address', c.address, 'bank_name', c.bank_name,
                             'bank_account', c.bank_account, 'default_currency', c.default_currency, 'notes', c.notes),
          jsonb_build_object('name', trim(p_name), 'contact', nullif(trim(p_contact), ''), 'city', nullif(trim(p_city), ''), 'phone', nullif(trim(p_phone), ''))
            || d);
end $$;

revoke all on function public.sal_create_customer(text, text, text, text, text, text, text, text, text, text, text, text, text),
  public.sal_update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.sal_create_customer(text, text, text, text, text, text, text, text, text, text, text, text, text),
  public.sal_update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

commit;

-- Verification (read-only): users can call them (true), anonymous cannot (false), and the eight columns exist (8).
select has_function_privilege('authenticated', 'public.sal_update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, text)', 'execute') as users_edit,
       has_function_privilege('anon', 'public.sal_create_customer(text, text, text, text, text, text, text, text, text, text, text, text, text)', 'execute') as anon_creates,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sal_customers'
          and column_name in ('tax_number', 'commercial_registry', 'email', 'address', 'bank_name', 'bank_account', 'default_currency', 'notes')) as new_columns;
