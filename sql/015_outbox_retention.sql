-- 015_outbox_retention.sql
-- O9 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): retention for operational messaging data. Delivered, failed, expired
-- and cancelled outbox rows, read notifications and used or expired decision tokens older than N days can be removed.
-- NOT SCHEDULED and DRY RUN BY DEFAULT: deleting data needs the owner's approval (see WORKLOG). Nothing in the audit log is ever
-- removed: it is append-only, and every real cleanup writes its own audit entry with the counts. Pending and in-flight
-- messages are never touched. A minimum of 7 days is enforced.
-- Depends on sql/001-014. Rerun-safe. Run the whole file, then sql/tests/011_outbox_retention.sql.

begin;

-- A notification outlives its outbox row (it keeps its own copy of the text).
alter table public.msg_notifications drop constraint if exists msg_notifications_outbox_id_fkey;
alter table public.msg_notifications add constraint msg_notifications_outbox_id_fkey foreign key (outbox_id) references public.msg_outbox(id) on delete set null;

-- Returns what would be (or was) removed. p_dry_run = true (the default) deletes nothing.
create or replace function public.msg_cleanup(p_keep_days int default 90, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz;
  o        record;
  n_out    int;
  n_notif  int;
  n_tok    int;
  t_out    int := 0;
  t_notif  int := 0;
  t_tok    int := 0;
begin
  if p_keep_days is null or p_keep_days < 7 then raise exception 'INVALID_INPUT' using detail = 'keep at least 7 days'; end if;
  v_cutoff := now() - p_keep_days * interval '1 day';

  for o in select og.id from public.organizations og where og.deleted_at is null loop
    select count(*) into n_out from public.msg_outbox x where x.org_id = o.id and x.status in ('sent', 'failed', 'expired', 'cancelled') and x.created_at < v_cutoff;
    select count(*) into n_notif from public.msg_notifications x where x.org_id = o.id and x.read_at is not null and x.created_at < v_cutoff;
    select count(*) into n_tok from public.msg_tokens x where x.org_id = o.id and (x.used_at is not null or x.expires_at < now()) and x.created_at < v_cutoff;
    t_out := t_out + n_out; t_notif := t_notif + n_notif; t_tok := t_tok + n_tok;

    if not p_dry_run and (n_out + n_notif + n_tok) > 0 then
      delete from public.msg_notifications x where x.org_id = o.id and x.read_at is not null and x.created_at < v_cutoff;
      delete from public.msg_tokens x where x.org_id = o.id and (x.used_at is not null or x.expires_at < now()) and x.created_at < v_cutoff;
      delete from public.msg_outbox x where x.org_id = o.id and x.status in ('sent', 'failed', 'expired', 'cancelled') and x.created_at < v_cutoff;
      insert into public.audit_log (org_id, action, entity_type, summary, metadata)
      values (o.id, 'messaging.cleanup.run', 'organization', format('Retention cleanup removed %s messages, %s notifications, %s tokens older than %s days', n_out, n_notif, n_tok, p_keep_days),
              jsonb_build_object('keep_days', p_keep_days, 'outbox', n_out, 'notifications', n_notif, 'tokens', n_tok));
    end if;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'keep_days', p_keep_days, 'outbox', t_out, 'notifications', t_notif, 'tokens', t_tok);
end $$;

revoke all on function public.msg_cleanup(int, boolean) from public, anon, authenticated;
grant execute on function public.msg_cleanup(int, boolean) to service_role;

commit;

-- Verification (read-only): signed-in users cannot run it (expect false).
select has_function_privilege('authenticated', 'public.msg_cleanup(int,boolean)', 'execute') as can_run;
