import { ATTACHMENT_ENTITY_TYPES, type Attachment, type AttachmentEntityType } from '@erp/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { MAX_UPLOAD, sha256Hex, sniffMime, UPLOAD_EXT, type UploadMime } from '../../lib/uploads';
import { KB, limitBody } from '../../middleware/bodyLimit';
import { requirePermission } from '../../middleware/tenant';

// Attachments (sql/108; SCANNING_PLAN.md step 3): photos and PDFs on records. The file goes to Supabase Storage (private bucket doc-files,
// folder org/<company id>/<record type>/<record id>/) with the person's OWN sign-in: the storage rules allow it only in the folder of a
// company they belong to. Then core_add_attachment checks the record and the file and writes the row and the audit row. No master key.
// Reading gives five-minute links. Removing is a soft delete (the file stays). Before sql/108: 503 not_set_up.
export const attachmentRoutes = new Hono<AppEnv>();

const BUCKET = 'doc-files';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SECONDS = 300;

const entityType = (x: unknown): AttachmentEntityType => {
  if (typeof x !== 'string' || !(ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(x)) invalid('Unknown record type');
  return x as AttachmentEntityType;
};
const entityId = (x: unknown): string => {
  if (typeof x !== 'string' || !UUID_RE.test(x)) invalid('Unknown record');
  return x as string;
};
/** Storage without the bucket (sql/108 not applied): say so plainly. */
const storageError = (e: { message?: string } | null): never => {
  if (e && /bucket not found/i.test(e.message ?? ''))
    throw new HttpError(503, 'Attachments need a database update (sql/108) first.', 'not_set_up');
  throw new HttpError(502, 'The file store did not accept the file. Try again.', 'storage_error');
};

type Row = {
  id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  file_path: string;
  file_name: string | null;
  mime: string;
  bytes: number;
  sha256: string;
  uploaded_by: string;
  created_at: string;
};

// ?entityType=supplier_bill&entityId=<uuid>
attachmentRoutes.get('/', requirePermission('core.attachments.read'), async (c) => {
  const type = entityType(c.req.query('entityType'));
  const id = entityId(c.req.query('entityId'));
  const db = userDb(c);
  const { data, error } = await db
    .from('core_attachments')
    .select('id,entity_type,entity_id,file_path,file_name,mime,bytes,sha256,uploaded_by,created_at')
    .eq('org_id', c.var.tenant.orgId)
    .eq('entity_type', type)
    .eq('entity_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const links = new Map<string, string>();
  if (rows.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(
      rows.map((r) => r.file_path),
      LINK_SECONDS,
    );
    for (const s of signed ?? []) if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
  }
  return ok<Attachment[]>(
    c,
    rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      fileName: r.file_name,
      mime: r.mime,
      bytes: Number(r.bytes),
      sha256: r.sha256,
      uploadedBy: r.uploaded_by,
      createdAt: r.created_at,
      url: links.get(r.file_path) ?? null,
    })),
  );
});

// multipart: file, entityType, entityId
attachmentRoutes.post('/', requirePermission('core.attachments.add'), limitBody(MAX_UPLOAD + 64 * KB), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const f = form?.get('file');
  if (!form || !(f instanceof File)) invalid('Send the picture or PDF as the form field "file"');
  const file = f as File;
  const type = entityType(form?.get('entityType'));
  const id = entityId(form?.get('entityId'));
  if (file.size === 0 || file.size > MAX_UPLOAD) throw new HttpError(413, 'The file must be between 1 byte and 10 MB', 'too_large');
  const bytes = await file.arrayBuffer();
  const mime = sniffMime(bytes);
  if (!mime) invalid('The file must be a JPEG, PNG or WebP picture, or a PDF');
  const sha256 = await sha256Hex(bytes);
  const path = `org/${c.var.tenant.orgId}/${type}/${id.toLowerCase()}/${crypto.randomUUID()}.${UPLOAD_EXT[mime as UploadMime]}`;
  const db = userDb(c);
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime as string, upsert: false });
  if (up.error) storageError(up.error);
  const name =
    [...(file.name || '')]
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join('')
      .slice(0, 200) || null;
  const attachmentId = await callRpc<string>(db, 'core_add_attachment', {
    p_entity_type: type,
    p_entity_id: id,
    p_path: path,
    p_name: name,
    p_mime: mime,
    p_bytes: bytes.byteLength,
    p_sha256: sha256,
  });
  return ok(c, { id: attachmentId, sha256 }, 201);
});

attachmentRoutes.delete('/:id', requirePermission('core.attachments.add'), async (c) => {
  const id = entityId(c.req.param('id'));
  await callRpc<void>(userDb(c), 'core_remove_attachment', { p_id: id });
  return ok(c, { removed: id });
});
