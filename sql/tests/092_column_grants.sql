-- sql/tests/092_column_grants.sql
-- Guard (18 Nov 2026, after sql/095 shipped inv_items.group_id without its read grant and every item screen hung on live): on tables that
-- signed-in users read column by column (no table-level SELECT), every column must be readable unless it is listed below with its reason.
-- A new column without its grant fails here, on the pull request, instead of on live. To hide a column on purpose, add it to the list.
-- Read-only. Needs all migrations.

do $$
declare
  -- Hidden on purpose (costs, secrets, codes), or not granted yet because no screen reads them (grant before a screen does).
  v_allowed text[] := array[
    'inv_items.avg_cost_minor',                   -- cost: only through owner/admin functions
    'inv_stock_moves.unit_cost_minor',            -- cost
    'msg_identities.code_hash',                   -- verification code
    'msg_identities.code_expires_at',             -- verification code
    'msg_identities.attempts',                    -- verification code
    'core_integrations.secret_id',                -- vault reference
    'msg_outbox.secret_body',                     -- message secret
    -- HR app copies (sql/102): members see the directory only; these come through hr_directory for owners and admins
    'hr_employees.work_email', 'hr_employees.hired_on', 'hr_employees.left_on', 'hr_employees.user_id', 'hr_employees.link_source',
    'hr_employees.source_updated_at', 'hr_employees.last_seen_run',   -- sync bookkeeping
    -- not read by any screen yet: grant them in the migration that first reads them
    'inv_stock_moves.transfer_id', 'inv_stock_moves.count_id', 'inv_stock_moves.note_id', 'inv_stock_moves.purchase_order_id',
    'msg_identities.updated_at', 'core_integrations.last_check_started_at', 'msg_outbox.delivered_via'
  ];
  v_new text;
begin
  select string_agg(t.relname || '.' || a.attname, ', ' order by 1) into v_new
    from pg_class t join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
   where t.relkind = 'r'
     and not has_table_privilege('authenticated', t.oid, 'SELECT')
     and exists (select 1 from pg_attribute a2 where a2.attrelid = t.oid and a2.attnum > 0 and not a2.attisdropped
                  and has_column_privilege('authenticated', t.oid, a2.attnum, 'SELECT'))
     and not has_column_privilege('authenticated', t.oid, a.attnum, 'SELECT')
     and (t.relname || '.' || a.attname) <> all (v_allowed);
  if v_new is not null then
    raise exception 'FAIL C1: columns signed-in users cannot read (grant select on them, or list them here with a reason): %', v_new;
  end if;
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
