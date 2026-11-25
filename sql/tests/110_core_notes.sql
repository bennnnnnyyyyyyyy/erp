-- sql/tests/110_core_notes.sql
-- Notes on records (sql/113). Always rolls back. Needs sql/001-113.
-- Covers: A1 a member adds a note on an item (audited with the text); A2 refusals (empty, too long, unknown type, a record of another
-- company or none, a viewer); R1 members and viewers read item notes; R2 expense notes: owners and admins only (add and read); D1 the
-- writer deletes their own; D2 another member cannot; D3 an admin deletes anyone's (audited with the text); D4 a deleted note is hidden;
-- W1 direct writes are refused; I1 another company reads nothing and cannot add or delete.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; it uuid; itb uuid; cat uuid; ex uuid; n1 uuid; n2 uuid; n3 uuid; ok boolean; n int; j jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'nt-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'nt-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'nt-m@tests.invalid'), (m2, 'authenticated', 'authenticated', 'nt-m2@tests.invalid'),
    (v, 'authenticated', 'authenticated', 'nt-v@tests.invalid'), (x, 'authenticated', 'authenticated', 'nt-x@tests.invalid');
  o := public.bootstrap_organization('Notes A', 'notes-a', 'nt-o@tests.invalid');
  ob := public.bootstrap_organization('Notes B', 'notes-b', 'nt-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member'), (o, m2, 'member'), (o, v, 'viewer');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.inv_create_warehouse('MAIN', 'Main', null);
  it := public.inv_create_item('NT-1', 'Cream', null, 'piece', 5, w);
  cat := public.fin_create_category('Rent');
  ex := (public.fin_record_expense(current_date, cat, 5000) ->> 'id')::uuid;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  itb := public.inv_create_item('NT-B', 'Other cream', null, 'piece', 0, public.inv_create_warehouse('MAIN', 'B', null));
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);

  -- A1: a member adds a note on an item
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  n1 := public.core_add_note('item', it, '  Supplier changed the box size  ');
  reset role;
  if (select body from public.core_notes where id = n1) <> 'Supplier changed the box size' then raise exception 'FAIL A1a: text not trimmed'; end if;
  if not exists (select 1 from public.audit_log where org_id = o and action = 'core.note.added' and entity_id = it::text and after ->> 'body' = 'Supplier changed the box size') then
    raise exception 'FAIL A1b: not audited with the text';
  end if;
  set local role authenticated;

  -- A2: refusals
  foreach j in array array[
      jsonb_build_object('t', 'item', 'id', it, 'b', '   '),
      jsonb_build_object('t', 'item', 'id', it, 'b', repeat('x', 2001)),
      jsonb_build_object('t', 'warehouse', 'id', w, 'b', 'hello'),
      jsonb_build_object('t', 'item', 'id', itb, 'b', 'hello'),
      jsonb_build_object('t', 'item', 'id', gen_random_uuid(), 'b', 'hello')]
  loop
    ok := false;
    begin perform public.core_add_note(j ->> 't', (j ->> 'id')::uuid, j ->> 'b');
    exception when others then ok := sqlerrm in ('INVALID_INPUT', 'NOT_FOUND');
    end;
    if not ok then raise exception 'FAIL A2: accepted %', left(j::text, 120); end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_add_note('item', it, 'viewer note'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL A2b: a viewer added a note'; end if;

  -- R1: a viewer and another member read the item note
  if (select count(*) from public.core_notes where entity_id = it) <> 1 then raise exception 'FAIL R1a: a viewer does not see the item note'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  if (select count(*) from public.core_notes where entity_id = it) <> 1 then raise exception 'FAIL R1b: another member does not see the item note'; end if;

  -- R2: expenses are owners' and admins' only
  ok := false; begin perform public.core_add_note('expense', ex, 'member note'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL R2a: a member added a note on an expense'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  n2 := public.core_add_note('expense', ex, 'Paid late, ask the landlord');
  if (select count(*) from public.core_notes where entity_id = ex) <> 1 then raise exception 'FAIL R2b: the admin does not see the expense note'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.core_notes where entity_id = ex) then raise exception 'FAIL R2c: a member reads an expense note'; end if;
  ok := false; begin perform public.core_delete_note(n2); exception when others then ok := (sqlerrm in ('NOT_FOUND', 'FORBIDDEN')); end;
  if not ok then raise exception 'FAIL R2d: a member deleted an expense note'; end if;

  -- D1/D2: the writer deletes their own; another member cannot
  n3 := public.core_add_note('item', it, 'second note');
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_delete_note(n3); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL D2: another member deleted a note'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.core_delete_note(n3);
  -- D3: an admin deletes anyone's
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.core_delete_note(n1);
  -- D4: deleted notes are hidden
  if exists (select 1 from public.core_notes where entity_id = it) then raise exception 'FAIL D4: a deleted note is still shown'; end if;
  ok := false; begin perform public.core_delete_note(n1); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL D4b: a note was deleted twice'; end if;

  -- W1: direct writes are refused
  ok := false; begin insert into public.core_notes (org_id, entity_type, entity_id, body, created_by) values (o, 'item', it, 'x', a); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL W1a: a direct insert worked'; end if;
  ok := false; begin update public.core_notes set body = 'changed'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL W1b: a direct update worked'; end if;

  -- I1: another company
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.core_notes) then raise exception 'FAIL I1a: another company reads notes'; end if;
  ok := false; begin perform public.core_add_note('expense', ex, 'spy'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1b: another company added a note on this company''s record'; end if;
  ok := false; begin perform public.core_delete_note(n2); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL I1c: another company deleted a note'; end if;
  reset role;

  select count(*) into n from public.audit_log where org_id = o and action = 'core.note.deleted' and before ->> 'body' in ('second note', 'Supplier changed the box size');
  if n <> 2 then raise exception 'FAIL D5: % delete audit rows with the text (expected 2)', n; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
