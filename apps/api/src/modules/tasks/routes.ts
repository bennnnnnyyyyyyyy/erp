import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Tasks (documentation/plans/TASKS_AND_OUTBOX_PLAN.md). Reads run as the signed-in user and filter by organization;
// every change is a database function that checks role and module and writes its audit row itself (ADR-0003).

export const tasksRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

type TaskRow = {
  id: string; title: string; description: string; assignee_id: string; created_by: string; due_at: string | null; status: string;
  linked_type: string | null; linked_id: string | null; completed_at: string | null; created_at: string;
};
const toTask = (r: TaskRow) => ({
  id: r.id, title: r.title, description: r.description, assigneeId: r.assignee_id, createdBy: r.created_by, dueAt: r.due_at,
  status: r.status, linkedType: r.linked_type, linkedId: r.linked_id, completedAt: r.completed_at, createdAt: r.created_at,
});
const COLUMNS = 'id, title, description, assignee_id, created_by, due_at, status, linked_type, linked_id, completed_at, created_at';

async function loadTask(c: Context<AppEnv>, id: string) {
  const { data, error } = await userDb(c).from('tsk_tasks').select(COLUMNS).eq('org_id', c.var.tenant.orgId).eq('id', id).maybeSingle<TaskRow>();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Task not found', 'not_found');
  return toTask(data);
}

tasksRoutes.get('/', requirePermission('tasks.tasks.read'), async (c) => {
  const { data, error } = await userDb(c).from('tsk_tasks').select(COLUMNS).eq('org_id', c.var.tenant.orgId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return ok(c, ((data ?? []) as TaskRow[]).map(toTask));
});

tasksRoutes.get('/:id', requirePermission('tasks.tasks.read'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Task not found', 'not_found');
  return ok(c, await loadTask(c, id));
});

tasksRoutes.post('/', requirePermission('tasks.tasks.create'), async (c) => {
  const body = await jsonBody(c);
  const title = text(body.title);
  const assigneeId = text(body.assigneeId);
  if (!title) invalid('Give the task a title');
  if (!UUID_RE.test(assigneeId)) invalid('Choose who the task is for');
  const dueAt = text(body.dueAt);
  if (dueAt && Number.isNaN(Date.parse(dueAt))) invalid('That due time is not valid');
  const id = await callRpc<string>(userDb(c), 'tsk_create_task', {
    p_title: title,
    p_assignee: assigneeId,
    p_due_at: dueAt ? new Date(dueAt).toISOString() : null,
    p_description: text(body.description),
  });
  return ok(c, await loadTask(c, id), 201);
});

tasksRoutes.post('/:id/status', requirePermission('tasks.tasks.update'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Task not found', 'not_found');
  const body = await jsonBody(c);
  const status = text(body.status);
  if (!['in_progress', 'done', 'cancelled'].includes(status)) invalid('Status must be in_progress, done or cancelled');
  await callRpc<void>(userDb(c), 'tsk_set_status', { p_task_id: id, p_status: status });
  return ok(c, await loadTask(c, id));
});
