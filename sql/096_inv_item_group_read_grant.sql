-- sql/096_inv_item_group_read_grant.sql
-- Fix for sql/095 (18 Nov 2026). inv_items is read through column-level grants (sql/036 granted select on its new columns one by one),
-- and sql/095 added inv_items.group_id without a grant. Every item list that asks for group_id was refused ("permission denied for
-- table inv_items"), so screens that load items (new purchase order, stock requests, invoices, items) stayed on "Loading…" on live and
-- the workflow tests failed from the first slice A commit. This grants read on the one column; RLS still limits rows to the company.
-- Needs sql/001-095. Rerun-safe. Ends with a read-only check.

begin;

grant select (group_id) on public.inv_items to authenticated;

commit;

-- Verification (read-only): signed-in users can read group_id; anonymous users cannot.
select has_column_privilege('authenticated', 'public.inv_items', 'group_id', 'select') as users_read_group_id,
       has_column_privilege('anon', 'public.inv_items', 'group_id', 'select') as anon_read_group_id;
