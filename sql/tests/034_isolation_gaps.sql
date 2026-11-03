-- sql/tests/034_isolation_gaps.sql
-- System audit 2026-11-03, finding 2: the business tables that no isolation test named yet. For each one, org A creates rows through
-- its normal database functions, then a member of org B (with org B selected) must see none of them and must not be able to write
-- to the table directly. For readable tables the test first proves org A's own user does see its rows, so a pass is not trivial.
-- Always rolls back. Needs sql/001-038.

do $$
declare
  u uuid := gen_random_uuid();   -- owner of org A
  x uuid := gen_random_uuid();   -- owner of org B
  o uuid; ob uuid; w uuid; i uuid; team uuid; t text; n bigint; ok boolean;
  readable text[] := array['inv_warehouses', 'inv_request_lines', 'pur_suppliers', 'inv_storage_conditions', 'alr_team_members', 'alr_rule_recipients'];
  closed   text[] := array['inv_counters'];
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'gap-a@tests.invalid'), (x, 'authenticated', 'authenticated', 'gap-b@tests.invalid');
  o  := public.bootstrap_organization('Isolation Gaps A', 'isolation-gaps-a', 'gap-a@tests.invalid');
  ob := public.bootstrap_organization('Isolation Gaps B', 'isolation-gaps-b', 'gap-b@tests.invalid');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- Org A fills every table through its own functions.
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('GAP', 'Gap warehouse');                                   -- inv_warehouses
  i := public.inv_create_item('GAP-1', 'Gap item', null, 'piece', 50, w);
  perform public.inv_submit_request(w, 'isolation test', jsonb_build_array(jsonb_build_object('itemId', i, 'qty', 1)));   -- inv_request_lines, inv_counters
  perform public.pur_create_supplier('Gap supplier');                                          -- pur_suppliers
  perform public.inv_create_storage_condition('Gap cold room', 2, 8);                          -- inv_storage_conditions
  perform public.alr_ensure_default_teams();
  select id into team from public.alr_teams where org_id = o and name = 'Purchasing';
  perform public.alr_set_team_members(team, array[u]);                                         -- alr_team_members
  perform public.alr_create_rule('Gap rule', 'stock_below', null, 10, 24, jsonb_build_array(jsonb_build_object('type', 'team', 'id', team)));   -- alr_rule_recipients

  -- T1: org A's own user sees its rows in every readable table (so the isolation checks below mean something).
  foreach t in array readable loop
    execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
    if n = 0 then raise exception 'FAIL T1: org A cannot see its own rows in % (setup did not create any?)', t; end if;
  end loop;
  reset role;

  -- T2: there really are rows in the closed table (checked as postgres).
  select count(*) into n from public.inv_counters where org_id = o;
  if n = 0 then raise exception 'FAIL T2: no inv_counters row was created for org A'; end if;

  -- Org B's owner, with org B selected.
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T3: org B sees none of org A's rows (readable tables), or cannot read the table at all (closed tables).
  foreach t in array readable || closed loop
    begin
      execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then raise exception 'FAIL T3: org B can see % of org A''s rows in %', n, t; end if;
  end loop;

  -- T4: org B cannot write to any of these tables directly (insert, update, delete are revoked).
  foreach t in array readable || closed loop
    ok := false;
    begin execute format('insert into public.%I (org_id) values ($1)', t) using ob; exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL T4a: direct insert into % was not refused by privileges', t; end if;
    ok := false;
    begin execute format('update public.%I set org_id = org_id where org_id = $1', t) using o; exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL T4b: direct update of % was not refused', t; end if;
    ok := false;
    begin execute format('delete from public.%I where org_id = $1', t) using o; exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL T4c: direct delete from % was not refused', t; end if;
  end loop;

  -- T5: org B cannot read org A's rows by selecting org A in the header either (not a member there).
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  foreach t in array readable loop
    begin
      execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
    exception when others then n := 0;   -- refused outright is also a pass
    end;
    if n <> 0 then raise exception 'FAIL T5: org B read % rows of % by sending org A''s id', n, t; end if;
  end loop;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
