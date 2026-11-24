-- sql/108_scanning.sql
-- Scanning (phase 1d): documentation/plans/SCANNING_PLAN.md; build plan approved by Ben 23 Nov 2026.
-- Step 0, AI providers with the company's own key: four more AI kinds in core_integrations (gemini, anthropic = Claude, grok,
--   openrouter), each with its own key and model; ai__provider_state covers all of them and the company's chosen "reader" (the
--   provider that reads bills); core_set_ai_reader chooses it; the AI notice becomes v3 because it now names more providers.
-- core_integrations kind check, core__provider_fields (from sql/102), core_save_integration (from sql/102), ai__provider_state and
-- core__ai_notice_version (from sql/061) and core_ai_status (from sql/056) are recreated from their latest versions with only these
-- additions.
-- Step 2, barcodes: inv_items.barcode (one per item, unique among a company's live items) with its column grant; inv_set_item_barcode.
-- Depends on sql/001-107. Rerun-safe. Then run sql/tests/105_scanning.sql.

begin;

-- ---------------------------------------------------------------- step 0: AI providers

alter table public.core_integrations drop constraint if exists core_integrations_kind_check;
alter table public.core_integrations add constraint core_integrations_kind_check check (kind in
  ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama', 'hr_app',
   'gemini', 'anthropic', 'grok', 'openrouter'));

alter table public.ai_usage drop constraint if exists ai_usage_provider_check;
alter table public.ai_usage add constraint ai_usage_provider_check check (provider in
  ('openai', 'elevenlabs', 'ollama', 'simulated', 'gemini', 'anthropic', 'grok', 'openrouter'));

-- sql/102's list plus the four new AI kinds. Their key is required: there is no shared key for them (Ben, 23 Nov).
-- Grok and OpenRouter have no sensible default model, so the model is required there.
create or replace function public.core__provider_fields(p_kind text)
returns table (field text, is_secret boolean, required boolean)
language sql immutable as $$
  select v.field, v.is_secret, v.required from (values
    ('paymob', 'secret_key', true, true), ('paymob', 'public_key', true, true), ('paymob', 'hmac_secret', true, true),
    ('paymob', 'integration_ids', false, true),
    ('fawry', 'merchant_code', false, true), ('fawry', 'secure_key', true, true),
    ('bosta', 'api_key', true, true), ('bosta', 'webhook_secret', true, true),
    ('shopify', 'shop_domain', false, true), ('shopify', 'client_id', false, true), ('shopify', 'webhook_secret', true, true),
    ('shopify', 'access_token', true, false), ('shopify', 'warehouse_code', false, false),
    ('openai', 'api_key', true, false), ('openai', 'model', false, false),
    ('elevenlabs', 'api_key', true, false),
    ('ollama', 'base_url', false, true), ('ollama', 'model', false, true), ('ollama', 'api_key', true, false),
    ('hr_app', 'base_url', false, true), ('hr_app', 'api_key', true, true),
    ('gemini', 'api_key', true, true), ('gemini', 'model', false, false),
    ('anthropic', 'api_key', true, true), ('anthropic', 'model', false, false),
    ('grok', 'api_key', true, true), ('grok', 'model', false, true),
    ('openrouter', 'api_key', true, true), ('openrouter', 'model', false, true)
  ) v(kind, field, is_secret, required) where v.kind = p_kind;
$$;
revoke all on function public.core__provider_fields(text) from public, anon, authenticated;

-- sql/102's function with the four AI kinds in the list of kinds and in the AI consent check; nothing else changes.
create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[]; v_missing text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama', 'hr_app',
                    'gemini', 'anthropic', 'grok', 'openrouter')
     or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
  if coalesce(p_mode, 'live') <> 'live' then raise exception 'INVALID_INPUT' using detail = 'test mode was removed; an integration is either off or on'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_enabled and p_kind in ('slack', 'teams', 'google_chat') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching it on';
  end if;
  if p_enabled then
    select array_agg(f.field) into v_missing from public.core__provider_fields(p_kind) f
     where f.required and not coalesce((r.settings -> 'saved_fields') ? f.field, false);
    if v_missing is not null then raise exception 'INVALID_STATE' using detail = format('save %s before switching it on', array_to_string(v_missing, ', ')); end if;
  end if;
  if p_kind in ('openai', 'elevenlabs', 'ollama', 'gemini', 'anthropic', 'grok', 'openrouter') and p_enabled and not public.core__ai_consent_current(v_org) then
    raise exception 'INVALID_STATE' using detail = 'the owner must accept the current AI data notice first';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, 'live', p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = 'live', enabled = excluded.enabled,
    settings = public.core_integrations.settings || jsonb_build_object('kinds', to_jsonb(v_kinds)), updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s', p_kind, case when p_enabled then 'on' else 'off' end),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;
revoke all on function public.core_save_integration(text, boolean, text, text[]) from public, anon;
grant execute on function public.core_save_integration(text, boolean, text, text[]) to authenticated;

-- The notice now names the new providers, so it asks the owner again (sql/061: only consent to the current version counts).
create or replace function public.core__ai_notice_version() returns text
language sql immutable as $$ select 'v3'::text $$;

-- The providers that can read a picture or a PDF of a bill (ElevenLabs is speech only).
create or replace function public.core__ai_reader_kinds() returns text[]
language sql immutable as $$ select array['openai', 'gemini', 'anthropic', 'grok', 'openrouter', 'ollama'] $$;

-- sql/061's function for all seven AI kinds, plus the company's chosen reader (organizations.settings.ai_reader; null = not chosen).
create or replace function public.ai__provider_state(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_consent boolean := public.core__ai_consent_current(p_org); r jsonb := '{}'::jsonb; k text; i public.core_integrations;
begin
  foreach k in array array['openai', 'elevenlabs', 'ollama', 'gemini', 'anthropic', 'grok', 'openrouter'] loop
    select * into i from public.core_integrations where org_id = p_org and kind = k;
    r := r || jsonb_build_object(k, jsonb_build_object(
      'enabled', coalesce(i.enabled, false) and v_consent,
      'simulated', false,
      'credentials', case when i.id is null then '{}'::jsonb else public.core__provider_credentials(p_org, k) end));
  end loop;
  return jsonb_build_object('consent', v_consent, 'providers', r,
    'reader', (select nullif(o.settings ->> 'ai_reader', '') from public.organizations o where o.id = p_org));
end $$;
revoke all on function public.ai__provider_state(uuid) from public, anon, authenticated;
grant execute on function public.ai__provider_state(uuid) to service_role;

-- Owners and admins choose which provider reads bills (null clears the choice: then the first one that is on is used). Audited.
create or replace function public.core_set_ai_reader(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_old text; v_new text := nullif(trim(coalesce(p_kind, '')), '');
begin
  if v_new is not null and not (v_new = any (public.core__ai_reader_kinds())) then
    raise exception 'INVALID_INPUT' using detail = 'this provider cannot read bills';
  end if;
  select nullif(settings ->> 'ai_reader', '') into v_old from public.organizations where id = v_org for update;
  if v_old is not distinct from v_new then return; end if;
  update public.organizations
     set settings = case when v_new is null then settings - 'ai_reader' else settings || jsonb_build_object('ai_reader', v_new) end
   where id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.ai.reader_changed', 'organization', v_org::text,
          format('AI that reads bills: %s', coalesce(v_new, 'not chosen')),
          jsonb_build_object('ai_reader', v_old), jsonb_build_object('ai_reader', v_new));
end $$;
revoke all on function public.core_set_ai_reader(text) from public, anon;
grant execute on function public.core_set_ai_reader(text) to authenticated;

-- sql/056's function plus the chosen reader.
create or replace function public.core_ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); c public.core_ai_consent;
begin
  select * into c from public.core_ai_consent where org_id = v_org and withdrawn_at is null;
  return jsonb_build_object(
    'consent', case when c.id is null then null else jsonb_build_object('version', c.notice_version, 'acceptedBy', c.accepted_by, 'acceptedAt', c.accepted_at) end,
    'monthCalls', (select count(*) from public.ai_usage where org_id = v_org and created_at >= date_trunc('month', now())),
    'monthSpendMicroUsd', (select coalesce(sum(cost_micro_usd), 0) from public.ai_usage where org_id = v_org and created_at >= date_trunc('month', now())),
    'reader', (select nullif(o.settings ->> 'ai_reader', '') from public.organizations o where o.id = v_org));
end $$;
revoke all on function public.core_ai_status() from public, anon;
grant execute on function public.core_ai_status() to authenticated;

-- ---------------------------------------------------------------- step 1: attachments (stored files on a record)
-- The files live in Supabase Storage, private bucket doc-files, under org/<company id>/... The API uploads with the person's own sign-in;
-- the storage policies below allow it only under the folder of a company the person belongs to (viewers can read, not upload). The row
-- here is written by core_add_attachment, which checks the record exists in the company and the file exists at that path.

create table if not exists public.core_attachments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  entity_type text not null check (entity_type in ('supplier_bill', 'purchase_order', 'purchase_receipt', 'sales_invoice', 'sales_order',
                                                   'customer', 'supplier', 'item', 'expense')),
  entity_id   uuid not null,
  file_path   text not null check (length(file_path) between 10 and 300),
  file_name   text check (file_name is null or length(file_name) between 1 and 200),
  mime        text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes       int not null check (bytes between 1 and 10485760),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users(id),
  unique (org_id, id)
);
create unique index if not exists core_attachments_path_uq on public.core_attachments (file_path);
create index if not exists core_attachments_entity_idx on public.core_attachments (org_id, entity_type, entity_id) where deleted_at is null;
alter table public.core_attachments enable row level security;
revoke all on public.core_attachments from anon, authenticated;
grant select on public.core_attachments to authenticated;
drop policy if exists core_attachments_member_read on public.core_attachments;
-- The records that take attachments are readable by every member of the company, so their files are too.
create policy core_attachments_member_read on public.core_attachments for select to authenticated
  using (public.is_org_member(org_id) and deleted_at is null);

-- The company of a storage path org/<uuid>/..., or null for any other path. Never raises (a bad name only means "no company").
create or replace function public.core__path_org(p_name text) returns uuid
language plpgsql immutable as $$
declare v text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if cardinality(v) < 3 or v[1] <> 'org' or v[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return v[2]::uuid;
end $$;

-- May the signed-in person read (p_write false) or upload (p_write true) at this storage path? Upload: owners, admins and members.
create or replace function public.core__storage_allowed(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.org_id = public.core__path_org(p_name) and m.user_id = auth.uid() and m.disabled_at is null
                    and (not p_write or m.role in ('owner', 'admin', 'member')));
$$;
revoke all on function public.core__storage_allowed(text, boolean) from public, anon;
grant execute on function public.core__storage_allowed(text, boolean) to authenticated;

-- Does this record exist in this company (and is it not deleted)?
create or replace function public.core__attachment_target_exists(p_org uuid, p_type text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_table text; v_ok boolean;
begin
  v_table := case p_type
    when 'supplier_bill' then 'pur_supplier_invoices' when 'purchase_order' then 'pur_orders' when 'purchase_receipt' then 'pur_receipts'
    when 'sales_invoice' then 'sal_invoices' when 'sales_order' then 'sal_orders' when 'customer' then 'sal_customers'
    when 'supplier' then 'pur_suppliers' when 'item' then 'inv_items' when 'expense' then 'fin_expenses' end;
  if v_table is null then return false; end if;
  execute format('select exists (select 1 from public.%I t where t.org_id = $1 and t.id = $2 and (to_jsonb(t) ->> ''deleted_at'') is null)', v_table)
    into v_ok using p_org, p_id;
  return v_ok;
end $$;
revoke all on function public.core__attachment_target_exists(uuid, text, uuid) from public, anon, authenticated;

-- Record a file the API has just uploaded with the person's own sign-in. Owners, admins and members. Audited.
create or replace function public.core_add_attachment(p_entity_type text, p_entity_id uuid, p_path text, p_name text, p_mime text,
  p_bytes int, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin', 'member']); v_id uuid; v_found boolean;
begin
  if p_entity_type is null or p_entity_id is null or p_path is null then raise exception 'INVALID_INPUT'; end if;
  if public.core__path_org(p_path) is distinct from v_org or p_path !~ '^org/[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then
    raise exception 'INVALID_INPUT' using detail = 'the file is not in this company''s folder';
  end if;
  if not public.core__attachment_target_exists(v_org, p_entity_type, p_entity_id) then raise exception 'NOT_FOUND'; end if;
  -- the file must really be there (Supabase Storage keeps its index in storage.objects; absent in plain Postgres test runs)
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = ''doc-files'' and name = $1)' into v_found using p_path;
    if not v_found then raise exception 'NOT_FOUND' using detail = 'the file was not uploaded'; end if;
  end if;
  insert into public.core_attachments (org_id, entity_type, entity_id, file_path, file_name, mime, bytes, sha256, uploaded_by)
  values (v_org, p_entity_type, p_entity_id, p_path, nullif(left(trim(coalesce(p_name, '')), 200), ''), p_mime, p_bytes, lower(p_sha256), auth.uid())
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'core.attachment.added', p_entity_type, p_entity_id::text, format('File attached (%s, %s bytes)', p_mime, p_bytes),
          jsonb_build_object('attachment_id', v_id, 'mime', p_mime, 'bytes', p_bytes, 'sha256', lower(p_sha256)));
  return v_id;
end $$;
revoke all on function public.core_add_attachment(text, uuid, text, text, text, int, text) from public, anon;
grant execute on function public.core_add_attachment(text, uuid, text, text, text, int, text) to authenticated;

-- Remove = soft delete (the file stays in storage). The person who added it, or an owner or admin. Audited.
create or replace function public.core_remove_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin', 'member']); a public.core_attachments; v_role text;
begin
  select * into a from public.core_attachments where org_id = v_org and id = p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select role into v_role from public.memberships where org_id = v_org and user_id = auth.uid();
  if a.uploaded_by <> auth.uid() and v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  update public.core_attachments set deleted_at = now(), deleted_by = auth.uid() where id = a.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'core.attachment.removed', a.entity_type, a.entity_id::text, 'File removed',
          jsonb_build_object('attachment_id', a.id, 'sha256', a.sha256));
end $$;
revoke all on function public.core_remove_attachment(uuid) from public, anon;
grant execute on function public.core_remove_attachment(uuid) to authenticated;

-- Storage: the private bucket and its rules (only where Supabase Storage exists; a plain Postgres test run has no storage schema).
do $st$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('doc-files', 'doc-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$q$;
  execute 'drop policy if exists doc_files_read on storage.objects';
  execute 'create policy doc_files_read on storage.objects for select to authenticated using (bucket_id = ''doc-files'' and public.core__storage_allowed(name, false))';
  execute 'drop policy if exists doc_files_upload on storage.objects';
  execute 'create policy doc_files_upload on storage.objects for insert to authenticated with check (bucket_id = ''doc-files'' and public.core__storage_allowed(name, true))';
  -- no update or delete policy: files are never changed or removed by users (removing an attachment is a soft delete)
end $st$;

-- ---------------------------------------------------------------- step 1: what the AI read (kept for checks and support)

create table if not exists public.core_ai_extractions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  kind        text not null check (kind in ('supplier_bill')),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),   -- the attachment with the same fingerprint, once the bill is saved
  mime        text not null check (length(mime) <= 40),
  bytes       int not null check (bytes > 0),
  provider    text not null check (provider in ('openai', 'gemini', 'anthropic', 'grok', 'openrouter', 'ollama')),
  model       text check (model is null or length(model) <= 120),
  status      text not null check (status in ('done', 'failed')),
  result      jsonb,                                                   -- what the AI read; never a key
  error       text check (error is null or length(error) <= 300),
  cost_micro  bigint not null default 0 check (cost_micro >= 0),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  check (result is null or pg_column_size(result) <= 200000)
);
create index if not exists core_ai_extractions_org_idx on public.core_ai_extractions (org_id, created_at desc);
alter table public.core_ai_extractions enable row level security;
revoke all on public.core_ai_extractions from anon, authenticated;
grant select on public.core_ai_extractions to authenticated;
drop policy if exists core_ai_extractions_admin_read on public.core_ai_extractions;
create policy core_ai_extractions_admin_read on public.core_ai_extractions for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = core_ai_extractions.org_id and m.user_id = (select auth.uid())
                  and m.disabled_at is null and m.role in ('owner', 'admin')));

-- Scanning a bill: owners and admins (Ben, 23 Nov: the same people who record bills). Logs what the AI read; audited (no content).
create or replace function public.pur_record_bill_scan(p_provider text, p_model text, p_status text, p_result jsonb, p_error text,
  p_sha256 text, p_mime text, p_bytes int, p_cost_micro bigint default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.pur__guard(array['owner', 'admin']); v_id uuid;
begin
  insert into public.core_ai_extractions (org_id, kind, file_sha256, mime, bytes, provider, model, status, result, error, cost_micro, created_by)
  values (v_org, 'supplier_bill', lower(p_sha256), p_mime, p_bytes, p_provider, nullif(left(coalesce(p_model, ''), 120), ''), p_status,
          case when p_status = 'done' then p_result end, left(p_error, 300), greatest(coalesce(p_cost_micro, 0), 0), auth.uid())
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'purchasing.bill.scanned', 'ai_extraction', v_id::text,
          format('Supplier bill read by %s (%s)', p_provider, p_status), jsonb_build_object('provider', p_provider, 'model', p_model, 'status', p_status));
  return v_id;
end $$;
revoke all on function public.pur_record_bill_scan(text, text, text, jsonb, text, text, text, int, bigint) from public, anon;
grant execute on function public.pur_record_bill_scan(text, text, text, jsonb, text, text, text, int, bigint) to authenticated;

-- What our own matching needs, read only. Owners and admins. Suppliers by tax number (digits only), else by a word of the name; for the
-- chosen supplier (p_supplier, or the best match): orders with received goods still to bill (lines with item codes, the supplier's own
-- codes from sql/099, units and the item's default VAT rate), and orders still waiting for goods ("receive the goods first").
create or replace function public.pur_bill_scan_candidates(p_tax_number text, p_name text, p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.pur__guard(array['owner', 'admin']);
  v_tax text := nullif(regexp_replace(coalesce(p_tax_number, ''), '\D', '', 'g'), '');
  v_words text[]; v_sup jsonb; v_pick uuid;
begin
  select coalesce(array_agg(w), '{}') into v_words
    from (select distinct w from unnest(regexp_split_to_array(lower(coalesce(p_name, '')), '[^[:alnum:]]+')) w where length(w) >= 3 limit 8) x;
  select coalesce(jsonb_agg(s order by s ->> 'how' desc, s ->> 'name'), '[]'::jsonb) into v_sup from (
    select jsonb_build_object('id', ps.id, 'name', ps.name, 'taxNumber', ps.tax_number,
             'how', case when v_tax is not null and regexp_replace(coalesce(ps.tax_number, ''), '\D', '', 'g') = v_tax then 'tax' else 'name' end) s
      from public.pur_suppliers ps
     where ps.org_id = v_org and ps.deleted_at is null
       and (ps.id = p_supplier
            or (v_tax is not null and regexp_replace(coalesce(ps.tax_number, ''), '\D', '', 'g') = v_tax)
            or exists (select 1 from unnest(v_words) w where lower(ps.name) like '%' || w || '%'))
     limit 50) q;
  v_pick := coalesce(p_supplier, (select (e ->> 'id')::uuid from jsonb_array_elements(v_sup) e where e ->> 'how' = 'tax' limit 1));
  return jsonb_build_object(
    'suppliers', v_sup,
    'supplierId', v_pick,
    'receivedOrders', case when v_pick is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.number, 'currency', po.currency, 'status', po.status, 'lines', (
        select jsonb_agg(jsonb_build_object(
                 'orderLineId', ol.id, 'itemId', ol.item_id, 'sku', it.sku, 'name', it.name, 'nameAr', it.name_ar,
                 'supplierCode', pc.code, 'supplierName', pc.name, 'unit', ol.unit, 'unitFactor', ol.unit_factor,
                 'orderedQty', ol.qty, 'receivedQty', ol.received_qty,
                 'billedQty', (select coalesce(sum(il.qty), 0) from public.pur_supplier_invoice_lines il where il.org_id = v_org and il.order_line_id = ol.id),
                 'unitCostMinor', ol.unit_cost_minor,
                 'vatRate', (select t.rate from public.tax_rates t where t.org_id = v_org and t.id = it.default_tax_rate_id and t.tax_type = 'T1' and t.deleted_at is null))
               order by it.sku)
          from public.pur_order_lines ol
          join public.inv_items it on it.org_id = ol.org_id and it.id = ol.item_id
          left join public.inv_party_item_codes pc on pc.org_id = ol.org_id and pc.item_id = ol.item_id and pc.party_type = 'supplier'
                                                   and pc.party_id = po.supplier_id and pc.deleted_at is null
         where ol.org_id = v_org and ol.order_id = po.id and ol.deleted_at is null)) order by po.created_at desc)
        from public.pur_orders po
       where po.org_id = v_org and po.supplier_id = v_pick and po.deleted_at is null
         and (po.status = 'received' or (po.status = 'ordered' and exists (select 1 from public.pur_order_lines x where x.org_id = v_org and x.order_id = po.id and x.received_qty > 0)))
         and exists (select 1 from public.pur_order_lines x where x.org_id = v_org and x.order_id = po.id and x.received_qty >
                       (select coalesce(sum(il.qty), 0) from public.pur_supplier_invoice_lines il where il.org_id = v_org and il.order_line_id = x.id))
    ), '[]'::jsonb) end,
    'waitingOrders', case when v_pick is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.number) order by po.created_at desc)
        from public.pur_orders po
       where po.org_id = v_org and po.supplier_id = v_pick and po.deleted_at is null and po.status = 'ordered'
         and not exists (select 1 from public.pur_order_lines x where x.org_id = v_org and x.order_id = po.id and x.received_qty > 0)
    ), '[]'::jsonb) end);
end $$;
revoke all on function public.pur_bill_scan_candidates(text, text, uuid) from public, anon;
grant execute on function public.pur_bill_scan_candidates(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------- step 2: barcodes
-- One barcode per item, unique in each company among live items (Ben, 23 Nov). Printable ASCII, up to 64 characters (EAN, UPC,
-- Code 128 and QR text all fit). inv_items is read through column grants: the grant comes in this same migration (sql/095 lesson).
alter table public.inv_items add column if not exists barcode text;
alter table public.inv_items drop constraint if exists inv_items_barcode_check;
alter table public.inv_items add constraint inv_items_barcode_check check (barcode is null or barcode ~ '^[!-~]{1,64}$');
create unique index if not exists inv_items_org_barcode_uq on public.inv_items (org_id, barcode)
  where barcode is not null and deleted_at is null;
grant select (barcode) on public.inv_items to authenticated;

-- Set or clear (null or blank) an item's barcode. Same roles as renaming an item (sql/062). Audited. A barcode that another live item of
-- the company already has: DUPLICATE, naming that item's code so the person can fix it.
create or replace function public.inv_set_item_barcode(p_item_id uuid, p_barcode text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.inv__guard(array['owner', 'admin', 'member']);
  v_code text := nullif(trim(coalesce(p_barcode, '')), '');
  i public.inv_items;
  v_other text;
begin
  if v_code is not null and v_code !~ '^[!-~]{1,64}$' then
    raise exception 'INVALID_INPUT' using detail = 'a barcode is up to 64 letters, digits or symbols, without spaces';
  end if;
  select * into i from public.inv_items where org_id = v_org and id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.barcode is not distinct from v_code then return; end if;
  if v_code is not null then
    select sku into v_other from public.inv_items where org_id = v_org and barcode = v_code and deleted_at is null and id <> i.id;
    if v_other is not null then raise exception 'DUPLICATE' using detail = format('item %s already has this barcode', v_other); end if;
  end if;
  begin
    update public.inv_items set barcode = v_code where org_id = v_org and id = i.id;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'another item already has this barcode';
  end;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'inventory.item.barcode_changed', 'item', i.id::text,
          format('%s: barcode %s', i.sku, coalesce(v_code, 'removed')),
          jsonb_build_object('barcode', i.barcode), jsonb_build_object('barcode', v_code));
end $$;
revoke all on function public.inv_set_item_barcode(uuid, text) from public, anon;
grant execute on function public.inv_set_item_barcode(uuid, text) to authenticated;

commit;

-- Verification (read-only).
select public.core__ai_notice_version() as notice_version;
select array(select field from public.core__provider_fields('anthropic')) as claude_fields;
select has_function_privilege('authenticated', 'public.ai__provider_state(uuid)', 'execute') as users_read_ai_state;
select has_function_privilege('authenticated', 'public.core_set_ai_reader(text)', 'execute') as users_choose_reader;
select has_table_privilege('authenticated', 'public.core_attachments', 'insert') as users_insert_attachments,
       has_table_privilege('authenticated', 'public.core_ai_extractions', 'insert') as users_insert_extractions;
select to_regclass('storage.buckets') is not null as storage_present;
select has_column_privilege('authenticated', 'public.inv_items', 'barcode', 'select') as users_read_barcodes,
       has_column_privilege('authenticated', 'public.inv_items', 'barcode', 'update') as users_write_barcodes,
       has_function_privilege('anon', 'public.inv_set_item_barcode(uuid, text)', 'execute') as anon_sets_barcodes;
