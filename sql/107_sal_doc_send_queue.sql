-- sql/107: send an invoice or note from the company (the "queue" send mode), plan documentation/plans/INVOICE_SEND_QUEUE_PLAN.md
-- (approved by Ben, 23 Nov 2026). Rerun-safe. Needs sql/001-106.
--
-- 1. The message queue (msg_outbox) learns messages to people outside the company: kind 'document', with the customer's address in
--    to_address (an email, or a WhatsApp number as digits) and no recipient_id. Only email and WhatsApp. The values a WhatsApp template
--    needs are in doc_params (not readable by users).
-- 2. sal_queue_doc_send: checks everything in one transaction (the person may send, the document is an issued invoice or approved note,
--    the company chose "send from the company", email is connected), makes or reuses the customer link, queues the message, writes the
--    send record (mode 'queue', with the message id) and the audit row. The same document to the same address on the same channel is
--    queued once a minute at most; a company queues at most 200 documents an hour.
-- 3. sal_doc_queue_status: the customer's saved email and phone, whether email is connected, and the last queued sends with their status.
-- 4. sal_record_doc_send (sql/103) now records device sends only: a 'queue' record is only ever written by sal_queue_doc_send.
-- A channel only delivers (jobs/outbox.ts); it never changes the invoice. The secret-key client is not used by any route for this.

begin;

-- ================================================================ 1. the queue: messages to customers

alter table public.msg_outbox add column if not exists to_address text check (to_address is null or length(to_address) <= 200);
alter table public.msg_outbox add column if not exists doc_params jsonb check (doc_params is null or jsonb_typeof(doc_params) = 'object');

alter table public.msg_outbox drop constraint if exists msg_outbox_kind_check;
alter table public.msg_outbox add constraint msg_outbox_kind_check check (kind in
  ('approval_request', 'decision', 'task_assigned', 'task_update', 'reminder', 'escalation', 'info', 'verification', 'alert', 'document'));

alter table public.msg_outbox drop constraint if exists msg_outbox_recipient_unless_channel_post;
alter table public.msg_outbox add constraint msg_outbox_recipient_unless_channel_post
  check (recipient_id is not null or channel in ('slack', 'teams', 'google_chat') or kind = 'document');

-- A document goes to an outside address by email or WhatsApp, never to a member; an outside address is only for a document.
alter table public.msg_outbox drop constraint if exists msg_outbox_document_shape;
alter table public.msg_outbox add constraint msg_outbox_document_shape check (
  (kind = 'document' and recipient_id is null and to_address is not null and channel in ('email', 'whatsapp'))
  or (kind <> 'document' and to_address is null and doc_params is null));

-- Owners and admins see delivery status (sql/007 policy); they may see where a document went. doc_params is never granted.
grant select (to_address) on public.msg_outbox to authenticated;

-- ================================================================ 2. send records know their message

alter table public.core_doc_sends add column if not exists outbox_id uuid;   -- no foreign key: old messages are cleaned up (sql/015)

-- ================================================================ 3. queue a send

create or replace function public.sal_queue_doc_send(p_doc_type text, p_doc_id uuid, p_channel text, p_to text, p_layout text,
                                                     p_language text, p_app_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.sal__guard(array['owner', 'admin', 'member']);
  v_lbl   text;
  v_to    text := lower(trim(coalesce(p_to, '')));
  v_lang  text := coalesce(nullif(p_language, ''), 'ar');
  v_key   text;
  v_id    uuid;
  v_send  uuid;
  v_mode  text;
  v_link  jsonb;
  v_url   text;
  d       jsonb;
  v_co    text;
  v_kind  text;
  v_ar    text;
  v_en    text;
  v_subj  text;
  v_body  text;
  n       int;
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'note') or p_doc_id is null then raise exception 'INVALID_INPUT'; end if;
  if p_channel is null or p_channel not in ('email', 'whatsapp') then raise exception 'INVALID_INPUT' using detail = 'email or whatsapp'; end if;
  if p_channel = 'email' and v_to !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INPUT' using detail = 'type the customer''s email address';
  end if;
  if p_channel = 'whatsapp' and v_to !~ '^[0-9]{8,15}$' then
    raise exception 'INVALID_INPUT' using detail = 'type the customer''s WhatsApp number with its country code';
  end if;
  if length(v_to) > 200 then raise exception 'INVALID_INPUT'; end if;
  if v_lang not in ('ar', 'en', 'both') then raise exception 'INVALID_INPUT'; end if;
  if p_layout is not null and p_layout not in ('simple', 'detailed', 'eta') then raise exception 'INVALID_INPUT'; end if;
  -- The app's own address, given by the API from its allowed list (never from the person): https, or http on this computer only.
  if p_app_url is null or p_app_url !~ '^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)$' then
    raise exception 'INVALID_INPUT' using detail = 'app address';
  end if;

  v_lbl := public.sal__doc_label(v_org, p_doc_type, p_doc_id);
  if v_lbl is null then raise exception 'NOT_FOUND'; end if;
  if not public.sal__doc_sendable(v_org, p_doc_type, p_doc_id) then
    raise exception 'INVALID_STATE' using detail = 'only an issued invoice or an approved note can be sent';
  end if;
  select send_mode into v_mode from public.core_doc_settings where org_id = v_org;
  if coalesce(v_mode, 'device') <> 'queue' then
    raise exception 'INVALID_STATE' using detail = 'your company sends from the person''s own device (Settings, Invoices and documents)';
  end if;
  if p_channel = 'email' and not exists (select 1 from public.core_integrations where org_id = v_org and kind = 'email' and enabled) then
    raise exception 'INVALID_STATE' using detail = 'email is not connected (Settings, Integrations)';
  end if;

  -- A double click sends once: the same document, channel and address within the same minute is the same message.
  v_key := format('doc:%s:%s:%s:%s:%s', p_doc_type, p_doc_id, p_channel, v_to, to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI'));
  select id into v_id from public.msg_outbox where org_id = v_org and idempotency_key = v_key;
  if found then
    return jsonb_build_object('outboxId', v_id, 'duplicate', true);
  end if;
  select count(*) into n from public.msg_outbox where org_id = v_org and kind = 'document' and created_at > now() - interval '1 hour';
  if n >= 200 then raise exception 'INVALID_STATE' using detail = 'too many documents sent in the last hour; try again later'; end if;

  v_link := public.sal_doc_link(p_doc_type, p_doc_id, false);
  v_url := p_app_url || '/i/' || (v_link ->> 'token');
  d := public.sal__doc_print_data(v_org, p_doc_type, p_doc_id);
  v_co := coalesce(nullif(d -> 'company' ->> 'legalName', ''), d -> 'company' ->> 'name');
  v_kind := coalesce(d -> 'document' ->> 'kind', 'invoice');
  -- The same words as a send from the device (apps/web/src/modules/sales/print/sendText.ts).
  v_ar := case v_kind when 'credit' then 'إشعار دائن' when 'debit' then 'إشعار مدين' else 'فاتورة' end || ' ' || v_lbl;
  v_en := case v_kind when 'credit' then 'Credit note' when 'debit' then 'Debit note' else 'Invoice' end || ' ' || v_lbl;
  v_subj := case v_lang when 'en' then v_en || ' - ' || v_co when 'ar' then v_ar || ' - ' || v_co
                        else v_ar || ' - ' || v_co || ' / ' || v_en || ' - ' || v_co end;
  v_body := case v_lang when 'en' then format(E'%s from %s:\n%s', v_en, v_co, v_url)
                        when 'ar' then format(E'%s من %s:\n%s', v_ar, v_co, v_url)
                        else format(E'%s من %s:\n%s\n\n%s from %s:\n%s', v_ar, v_co, v_url, v_en, v_co, v_url) end;

  insert into public.msg_outbox (org_id, recipient_id, channel, kind, subject, body, entity_type, entity_id, idempotency_key, max_attempts,
                                 expires_at, to_address, doc_params)
  values (v_org, null, p_channel, 'document', left(v_subj, 300), v_body,
          case p_doc_type when 'invoice' then 'sales_invoice' else 'sales_note' end, p_doc_id, v_key, 3, now() + interval '24 hours', v_to,
          jsonb_build_object('company', v_co, 'document', case v_lang when 'en' then v_en else v_ar end, 'documentEn', v_en, 'documentAr', v_ar,
                             'grossMinor', (d -> 'document' ->> 'grossMinor')::bigint, 'currency', d -> 'document' ->> 'currency',
                             'url', v_url, 'language', v_lang))
  returning id into v_id;

  insert into public.core_doc_sends (org_id, doc_type, doc_id, channel, mode, recipient, layout, language, sent_by, outbox_id)
  values (v_org, p_doc_type, p_doc_id, p_channel, 'queue', v_to, p_layout, v_lang, auth.uid(), v_id) returning id into v_send;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.document.queued', case p_doc_type when 'invoice' then 'sales_invoice' else 'sales_note' end, p_doc_id::text,
          format('%s: queued to send by %s to %s from the company', v_lbl, case p_channel when 'email' then 'email' else 'WhatsApp' end, v_to));
  return jsonb_build_object('outboxId', v_id, 'sendId', v_send, 'duplicate', false);
end $$;
revoke all on function public.sal_queue_doc_send(text, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.sal_queue_doc_send(text, uuid, text, text, text, text, text) to authenticated;

-- ================================================================ 4. what the print page shows

create or replace function public.sal_doc_queue_status(p_doc_type text, p_doc_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid := public.sal__guard(array['owner', 'admin', 'member', 'viewer']);
  v_cust uuid;
  c      public.sal_customers%rowtype;
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'note') or p_doc_id is null then raise exception 'INVALID_INPUT'; end if;
  if public.sal__doc_label(v_org, p_doc_type, p_doc_id) is null then raise exception 'NOT_FOUND'; end if;
  select i.customer_id into v_cust from public.sal_invoices i
   where i.org_id = v_org and i.id = case p_doc_type when 'invoice' then p_doc_id
                                       else (select n.invoice_id from public.sal_notes n where n.org_id = v_org and n.id = p_doc_id) end;
  select * into c from public.sal_customers where org_id = v_org and id = v_cust;
  return jsonb_build_object(
    'sendMode', coalesce((select send_mode from public.core_doc_settings where org_id = v_org), 'device'),
    'emailConnected', exists (select 1 from public.core_integrations where org_id = v_org and kind = 'email' and enabled),
    'customerEmail', c.email,
    'customerPhone', c.phone,
    'sends', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'channel', s.channel, 'recipient', s.recipient, 'queuedAt', s.sent_at,
                                          'status', coalesce(m.status, 'unknown'), 'error', m.last_error, 'deliveredAt', m.sent_at)
                       order by s.sent_at desc)
        from (select * from public.core_doc_sends
               where org_id = v_org and doc_type = p_doc_type and doc_id = p_doc_id and mode = 'queue'
               order by sent_at desc limit 20) s
        left join public.msg_outbox m on m.org_id = v_org and m.id = s.outbox_id), '[]'::jsonb));
end $$;
revoke all on function public.sal_doc_queue_status(text, uuid) from public, anon;
grant execute on function public.sal_doc_queue_status(text, uuid) to authenticated;

-- ================================================================ 5. device records stay device records

create or replace function public.sal_record_doc_send(p_doc_type text, p_doc_id uuid, p_channel text, p_mode text, p_recipient text,
                                                      p_layout text, p_language text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.sal__guard(array['owner', 'admin', 'member']);
  v_lbl text;
  v_id  uuid;
  v_to  text := nullif(trim(coalesce(p_recipient, '')), '');
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'note') or p_doc_id is null then raise exception 'INVALID_INPUT'; end if;
  -- sql/107: a 'queue' record is written only by sal_queue_doc_send, with its message.
  if coalesce(p_mode, 'device') <> 'device' then raise exception 'INVALID_INPUT' using detail = 'only a send from the device is recorded here'; end if;
  v_lbl := public.sal__doc_label(v_org, p_doc_type, p_doc_id);
  if v_lbl is null then raise exception 'NOT_FOUND'; end if;
  if not public.sal__doc_sendable(v_org, p_doc_type, p_doc_id) then
    raise exception 'INVALID_STATE' using detail = 'only an issued invoice or an approved note can be sent';
  end if;
  begin
    insert into public.core_doc_sends (org_id, doc_type, doc_id, channel, mode, recipient, layout, language, sent_by)
    values (v_org, p_doc_type, p_doc_id, p_channel, 'device', v_to, p_layout, p_language, auth.uid()) returning id into v_id;
  exception when check_violation or not_null_violation then raise exception 'INVALID_INPUT';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'sales.document.sent', case p_doc_type when 'invoice' then 'sales_invoice' else 'sales_note' end, p_doc_id::text,
          format('%s: %s%s', v_lbl,
                 case p_channel when 'whatsapp' then 'sent by WhatsApp' when 'email' then 'sent by email' when 'download' then 'PDF downloaded'
                                when 'print' then 'printed' else 'link copied' end,
                 case when v_to is null then '' else ' to ' || v_to end));
  return v_id;
end $$;
revoke all on function public.sal_record_doc_send(text, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.sal_record_doc_send(text, uuid, text, text, text, text, text) to authenticated;

commit;

-- Verification (read-only).
select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'msg_outbox_kind_check') ~ 'document' as kind_document,          -- true
       exists (select 1 from pg_constraint where conname = 'msg_outbox_document_shape') as document_shape,                                    -- true
       has_column_privilege('authenticated', 'public.msg_outbox', 'doc_params', 'select') as users_read_doc_params,                          -- false
       has_column_privilege('authenticated', 'public.msg_outbox', 'to_address', 'select') as users_read_to_address,                          -- true
       has_function_privilege('anon', 'public.sal_queue_doc_send(text,uuid,text,text,text,text,text)', 'execute') as anon_queues,            -- false
       has_function_privilege('authenticated', 'public.sal_queue_doc_send(text,uuid,text,text,text,text,text)', 'execute') as users_queue,   -- true
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'core_doc_sends' and column_name = 'outbox_id') as sends_outbox_id; -- true
