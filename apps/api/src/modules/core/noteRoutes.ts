import { NOTE_ENTITY_TYPES, NOTE_MAX_CHARS, type NoteEntityType, type RecordNote } from '@erp/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Notes on records (sql/113; Ben's decisions 25 Nov 2026). Read with the person's own sign-in: the database shows a note only to people
// who may see its record. core_add_note checks the record again and audits; core_delete_note lets the writer, or an owner or admin,
// delete one (a soft delete, audited). Before sql/113: 503 not_set_up (the app's error handler).
export const noteRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const entityType = (x: unknown): NoteEntityType => {
  if (typeof x !== 'string' || !(NOTE_ENTITY_TYPES as readonly string[]).includes(x)) invalid('Unknown record type');
  return x as NoteEntityType;
};
const uuid = (x: unknown, what: string): string => {
  if (typeof x !== 'string' || !UUID_RE.test(x)) invalid(what);
  return x as string;
};

type Row = { id: string; entity_type: NoteEntityType; entity_id: string; body: string; created_by: string; created_at: string };

// ?entityType=sales_invoice&entityId=<uuid>
noteRoutes.get('/', requirePermission('core.notes.read'), async (c) => {
  const type = entityType(c.req.query('entityType'));
  const id = uuid(c.req.query('entityId'), 'Unknown record');
  const { data, error } = await userDb(c)
    .from('core_notes')
    .select('id,entity_type,entity_id,body,created_by,created_at')
    .eq('org_id', c.var.tenant.orgId)
    .eq('entity_type', type)
    .eq('entity_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return ok<RecordNote[]>(
    c,
    ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      body: r.body,
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
  );
});

// { entityType, entityId, body }
noteRoutes.post('/', requirePermission('core.notes.add'), async (c) => {
  const b = await jsonBody(c);
  const type = entityType(b.entityType);
  const id = uuid(b.entityId, 'Unknown record');
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (!body) invalid('Write the note');
  if (body.length > NOTE_MAX_CHARS) invalid(`Note: at most ${NOTE_MAX_CHARS} characters`);
  const noteId = await callRpc<string>(userDb(c), 'core_add_note', { p_entity_type: type, p_entity_id: id, p_body: body });
  return ok<{ id: string }>(c, { id: noteId }, 201);
});

noteRoutes.delete('/:id', requirePermission('core.notes.add'), async (c) => {
  const id = uuid(c.req.param('id'), 'Unknown note');
  await callRpc<void>(userDb(c), 'core_delete_note', { p_id: id });
  return ok(c, { deleted: id });
});
