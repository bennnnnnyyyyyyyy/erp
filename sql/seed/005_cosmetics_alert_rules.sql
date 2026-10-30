-- sql/seed/005_cosmetics_alert_rules.sql
-- DEMO DATA, not a migration. Teams and starter alert rules for "Demo Cosmetics Factory (sample data)" (seed 004). Written directly
-- (the app's functions need a signed-in user), with one audit entry. Safe to rerun: does nothing if the organization already has rules.
-- Teams: Purchasing (Joseph), Warehouse (Grant), Management (Chris). Rules: low stock and expiring stock tell Purchasing, overdue invoices
-- tell Management, a losing month tells all owners. Needs sql/001-028 and seed 004.

do $$
declare
  oid uuid; t_pur uuid; t_wh uuid; t_mgmt uuid; r uuid;
  uo uuid; um uuid; ur uuid;
begin
  select id into oid from public.organizations where slug = 'demo-cosmetics' and deleted_at is null;
  if oid is null then raise exception 'Load seed 004 first'; end if;
  if exists (select 1 from public.alr_rules where org_id = oid) then raise notice 'rules already exist, nothing to do'; return; end if;
  select id into uo from auth.users where lower(email) = 'chris.johnson.wiz@gmail.com';
  select id into um from auth.users where lower(email) = 'joseph.brown.wiz@gmail.com';
  select id into ur from auth.users where lower(email) = 'grant.holden.wiz@gmail.com';

  insert into public.alr_teams (org_id, name) values (oid, 'Purchasing') on conflict do nothing;
  insert into public.alr_teams (org_id, name) values (oid, 'Warehouse') on conflict do nothing;
  insert into public.alr_teams (org_id, name) values (oid, 'Management') on conflict do nothing;
  select id into t_pur from public.alr_teams where org_id = oid and name = 'Purchasing';
  select id into t_wh from public.alr_teams where org_id = oid and name = 'Warehouse';
  select id into t_mgmt from public.alr_teams where org_id = oid and name = 'Management';
  insert into public.alr_team_members (org_id, team_id, user_id) values (oid, t_pur, um), (oid, t_wh, ur), (oid, t_mgmt, uo) on conflict do nothing;

  insert into public.alr_rules (org_id, name, kind, threshold, repeat_hours, created_by) values (oid, 'Low stock (each item''s reorder level)', 'stock_below', null, 24, uo) returning id into r;
  insert into public.alr_rule_recipients (org_id, rule_id, team_id) values (oid, r, t_pur);
  insert into public.alr_rules (org_id, name, kind, threshold, repeat_hours, created_by) values (oid, 'Stock expiring within 60 days', 'expiry_within', 60, 72, uo) returning id into r;
  insert into public.alr_rule_recipients (org_id, rule_id, team_id) values (oid, r, t_pur);
  insert into public.alr_rule_recipients (org_id, rule_id, role) values (oid, r, 'owner');
  insert into public.alr_rules (org_id, name, kind, threshold, repeat_hours, created_by) values (oid, 'Customer invoices unpaid after 30 days', 'receivable_overdue', 30, 168, uo) returning id into r;
  insert into public.alr_rule_recipients (org_id, rule_id, team_id) values (oid, r, t_mgmt);
  insert into public.alr_rules (org_id, name, kind, threshold, repeat_hours, created_by) values (oid, 'The month is losing money', 'profit_negative', null, 72, uo) returning id into r;
  insert into public.alr_rule_recipients (org_id, rule_id, role) values (oid, r, 'owner');

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (oid, uo, 'demo.alert_rules_seeded', 'organization', oid::text, 'Sample teams and 4 starter alert rules loaded');
end $$;

select (select count(*) from public.alr_rules r join public.organizations o on o.id = r.org_id where o.slug = 'demo-cosmetics') as rules,
       (select count(*) from public.alr_teams t join public.organizations o on o.id = t.org_id where o.slug = 'demo-cosmetics') as teams;

-- Added with sql/030: a forecast-based rule (needs sql/030). Rerunnable.
do $$
declare oid uuid; t_pur uuid; uo uuid; r uuid;
begin
  select id into oid from public.organizations where slug = 'demo-cosmetics' and deleted_at is null;
  if oid is null or exists (select 1 from public.alr_rules where org_id = oid and kind = 'forecast_stockout') then return; end if;
  select id into t_pur from public.alr_teams where org_id = oid and name = 'Purchasing';
  select id into uo from auth.users where lower(email) = 'chris.johnson.wiz@gmail.com';
  insert into public.alr_rules (org_id, name, kind, threshold, repeat_hours, created_by) values (oid, 'Will run out within 45 days (forecast)', 'forecast_stockout', 45, 72, uo) returning id into r;
  insert into public.alr_rule_recipients (org_id, rule_id, team_id) values (oid, r, t_pur);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary) values (oid, uo, 'demo.alert_rules_seeded', 'organization', oid::text, 'Starter forecast alert rule loaded');
end $$;