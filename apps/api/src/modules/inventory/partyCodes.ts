import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

// Supplier and customer item codes (sql/099, documentation/plans/MASTER_DATA_PLAN.md slice B): the code a supplier or customer uses
// for one of our items. Everyone reads them; only owners and admins add, change or remove one (Ben, 18 Nov; the database re-checks).
// Before sql/099 is applied these routes answer 503 not_set_up (the app's missing-schema handler).

const PARTY_TYPES = ['supplier', 'customer'] as const;
type PartyType = (typeof PARTY_TYPES)[number];

function partyType(raw: unknown): PartyType {
  if (typeof raw !== 'string' || !(PARTY_TYPES as readonly string[]).includes(raw)) invalid('partyType is supplier or customer');
  return raw as PartyType;
}
function uuid(raw: unknown, what: string): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) invalid(`${what} must be an id`);
  return raw as string;
}

type CodeRow = { item_id: string; party_type: PartyType; party_id: string; code: string; name: string | null; updated_at: string };
const toCode = (r: CodeRow) => ({
  itemId: r.item_id,
  partyType: r.party_type,
  partyId: r.party_id,
  code: r.code,
  name: r.name ?? '',
  updatedAt: r.updated_at,
});

export function registerPartyCodeRoutes(inventoryRoutes: Hono<AppEnv>) {
  // ?itemId= (an item's codes at every party) or ?partyType=&partyId= (one party's codes for every item).
  inventoryRoutes.get('/party-item-codes', requirePermission('inventory.items.read'), async (c) => {
    const itemId = c.req.query('itemId');
    const type = c.req.query('partyType');
    const partyId = c.req.query('partyId');
    let query = userDb(c)
      .from('inv_party_item_codes')
      .select('item_id, party_type, party_id, code, name, updated_at')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null);
    if (itemId) query = query.eq('item_id', uuid(itemId, 'itemId'));
    else if (type || partyId) query = query.eq('party_type', partyType(type)).eq('party_id', uuid(partyId, 'partyId'));
    else invalid('Give itemId, or partyType and partyId');
    const { data, error } = await query.order('code').limit(2000);
    if (error) throw error;
    return ok(c, ((data ?? []) as CodeRow[]).map(toCode));
  });

  // Items whose code at this party matches the text (for searching on orders and bills).
  inventoryRoutes.get('/party-item-codes/find', requirePermission('inventory.items.read'), async (c) => {
    const type = partyType(c.req.query('partyType'));
    const partyId = uuid(c.req.query('partyId'), 'partyId');
    const q = text(c.req.query('q'));
    if (!q || q.length > 64) invalid('q is 1 to 64 characters');
    const rows = await callRpc<{ item_id: string; code: string; name: string | null }[]>(userDb(c), 'inv_find_items_by_party_code', {
      p_party_type: type,
      p_party_id: partyId,
      p_text: q,
    });
    return ok(
      c,
      (rows ?? []).map((r) => ({ itemId: r.item_id, code: r.code, name: r.name ?? '' })),
    );
  });

  // Add or change a party's code for an item: { partyType, partyId, code, name? }.
  inventoryRoutes.put('/items/:id/party-codes', requirePermission('inventory.party_codes.manage'), async (c) => {
    const id = idParam(c);
    const body = await jsonBody(c);
    const type = partyType(body.partyType);
    const partyId = uuid(body.partyId, 'partyId');
    const code = text(body.code);
    const name = text(body.name);
    if (!code || code.length > 64) invalid('A code of 1 to 64 characters is required');
    if (name.length > 200) invalid('The name is up to 200 characters');
    await callRpc<string>(userDb(c), 'inv_set_party_item_code', {
      p_item_id: id,
      p_party_type: type,
      p_party_id: partyId,
      p_code: code,
      p_name: name || null,
    });
    return ok(c, { itemId: id, partyType: type, partyId, code, name });
  });

  inventoryRoutes.delete('/items/:id/party-codes/:partyType/:partyId', requirePermission('inventory.party_codes.manage'), async (c) => {
    const id = idParam(c);
    const type = partyType(c.req.param('partyType'));
    const partyId = c.req.param('partyId') ?? '';
    if (!UUID_RE.test(partyId)) throw new HttpError(404, 'Not found', 'not_found');
    await callRpc<void>(userDb(c), 'inv_remove_party_item_code', { p_item_id: id, p_party_type: type, p_party_id: partyId });
    return ok(c, { removed: true });
  });
}
