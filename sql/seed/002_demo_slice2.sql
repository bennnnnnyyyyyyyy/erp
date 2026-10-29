-- sql/seed/002_demo_slice2.sql
-- DEMO DATA for slice 2 (tasks and notifications). Needs sql/001-007 and sql/seed/001_demo_organization.sql.
-- For the demo organization "Demo Trading Co.":
--   * switches the `messaging` and `tasks` modules on;
--   * sets short chasing times so the demo does not take hours: reminder after 1 minute, escalation after 3 minutes
--     (production default is 30 and 120);
--   * the manager (joseph) assigns the staff member (grant) a task due in 3 minutes;
--   * the staff member submits a new stock request, which queues an approval notification for the managers.
-- The older waiting request OUT-0002 is chased on the first delivery pass because it has waited longer than the
-- reminder time. Safe to rerun: does nothing more once the task exists. Never deletes anything.
-- Run: supabase db query --linked -f sql/seed/002_demo_slice2.sql

do $$
declare
  oid uuid;
  uo uuid;
  um uuid;
  ur uuid;
  w  uuid;
  i  uuid;
begin
  select id into oid from public.organizations where slug = 'demo-trading';
  if oid is null then raise exception 'Run sql/seed/001_demo_organization.sql first'; end if;
  select id into uo from auth.users where lower(email) = 'chris.johnson.wiz@gmail.com';
  select id into um from auth.users where lower(email) = 'joseph.brown.wiz@gmail.com';
  select id into ur from auth.users where lower(email) = 'grant.holden.wiz@gmail.com';

  insert into public.org_modules (org_id, module_key, enabled_by) values (oid, 'messaging', uo), (oid, 'tasks', uo)
  on conflict (org_id, module_key) do update set disabled_at = null, enabled_at = now(), enabled_by = excluded.enabled_by;
  update public.organizations set settings = settings || '{"chasing": {"reminder_after_minutes": 1, "escalate_after_minutes": 3}}'::jsonb where id = oid;

  if exists (select 1 from public.tsk_tasks where org_id = oid and title = 'Count aisle 4') then
    raise notice 'Slice 2 demo data already exists; nothing more to do.';
    return;
  end if;

  -- The manager assigns a task to the staff member.
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oid)::text, true);
  perform public.tsk_create_task('Count aisle 4', ur, now() + interval '3 minutes', 'Report back when it is done');

  -- The staff member asks for stock; the managers are notified.
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  select it.id into i from public.inv_items it where it.org_id = oid and it.sku = 'GLV-001';
  select wh.id into w from public.inv_warehouses wh where wh.org_id = oid and wh.code = 'MAIN';
  perform public.inv_submit_request(w, 'Gloves for the day shift', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 20)));
end $$;
