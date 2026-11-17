-- 090_core_default_currency_egp.sql
-- The default currency for a NEW company goes back to EGP (Ben, 16 Nov 2026).
-- Found 16 Nov (read-only check on live): organizations.default_currency defaulted to 'USD' on live, while sql/001 sets 'EGP' and
-- agents.md says "Default currency is EGP, but it is a setting". The change was made outside the migrations. bootstrap_organization
-- sets no currency, so every company created without one started in USD.
-- Only the column default changes. No existing company is touched: each keeps its currency, documents, balances and settings.
-- Rerun-safe. Ends with read-only checks.

begin;

alter table public.organizations alter column default_currency set default 'EGP';

commit;

-- Verification (read-only): the default is now EGP (expect 'EGP'::bpchar), and how many companies use each currency (information only;
-- nothing was changed).
select (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'default_currency') as default_currency_now,
       (select string_agg(c || ': ' || n, ', ' order by c) from (select default_currency::text as c, count(*) as n from public.organizations group by 1) z) as companies_by_currency;
