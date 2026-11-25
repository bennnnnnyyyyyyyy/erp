-- sql/116_party_detail_rules.sql
-- Ben, 25 Nov 2026 (via erp-master): the boxes now guide the person while they type, and the database refuses the same things.
-- Customers and suppliers (details from sql/076 and sql/081), added NOT VALID (new and changed rows are checked; existing rows are
-- left alone until changed; the dry run counts them):
-- - email: name@domain.tld, no spaces or commas (the tester's "lskalmsalsasm.,ma" is refused), at most 200 (already);
-- - tax registration and commercial registry numbers: digits, with spaces or dashes between groups (Arabic digits accepted);
-- - bank account: digits, or an IBAN (two letters, two digits, 11-30 letters or digits; an Egyptian IBAN is 29 characters).
-- The same rules as packages/shared/src/fieldRules.ts (emailOk, registryOk, bankAccountOk), used by the screens and the API.
-- Rerun-safe. Needs sql/001-115 (core__add_check from sql/114). Then run sql/tests/113_party_detail_rules.sql and
-- sql/tests/092_column_grants.sql. Ends with read-only checks.

begin;

create or replace function public.core__email_ok(p text) returns boolean
language sql immutable as $$
  select p is null or btrim(p) = ''
      or (length(btrim(p)) <= 200
          and btrim(p) ~ '^[^[:space:]@,;<>()"]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$')
$$;

create or replace function public.core__registry_ok(p text) returns boolean
language sql immutable as $$
  select p is null or btrim(p) = ''
      or translate(btrim(p), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789') ~ '^[0-9]+([[:space:]-][0-9]+)*$'
$$;

create or replace function public.core__bank_account_ok(p text) returns boolean
language sql immutable as $$
  with s as (select upper(regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[[:space:]-]', '', 'g')) as v)
  select case
    when v = '' then true
    when v ~ '^[A-Z]{2}' then v ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' and (v !~ '^EG' or length(v) = 29)
    else v ~ '^[0-9]{4,34}$'
  end from s
$$;

select public.core__add_check('sal_customers', 'sal_customers_details_rules_chk',
  'public.core__email_ok(email) and public.core__registry_ok(tax_number) and public.core__registry_ok(commercial_registry) and public.core__bank_account_ok(bank_account)');
select public.core__add_check('pur_suppliers', 'pur_suppliers_details_rules_chk',
  'public.core__email_ok(email) and public.core__registry_ok(tax_number) and public.core__registry_ok(commercial_registry) and public.core__bank_account_ok(bank_account)');

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: false, true, true, false, true, false, true, true.
select public.core__email_ok('lskalmsalsasm.,ma') as tester_email_ok, public.core__email_ok('sales@nile.com.eg') as good_email_ok,
       public.core__registry_ok('123-456-789') as registry_ok, public.core__registry_ok('12a4') as bad_registry_ok,
       public.core__bank_account_ok('EG380019000500000000263180002') as eg_iban_ok, public.core__bank_account_ok('EG38 0019') as short_iban_ok,
       exists (select 1 from pg_constraint where conname = 'sal_customers_details_rules_chk' and not convalidated) as customers_rule,
       exists (select 1 from pg_constraint where conname = 'pur_suppliers_details_rules_chk' and not convalidated) as suppliers_rule;
