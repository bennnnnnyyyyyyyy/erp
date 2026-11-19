import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { userDb } from './db.user';
import { isMissingSchema } from './errors';
import { callRpc } from './rpc';

/**
 * Records the unit each order line was typed in (master data slice D, sql/101, ADR-0006). The line itself is already saved in base
 * units (quantity in pieces, price per piece), so this only adds "typed as 3 box". Lines in the base unit are not sent.
 *
 * Returns null, or the reason the units could not be recorded: the order is then kept in pieces (its quantities and prices are right)
 * and the screen says so, instead of failing an order that was already created. Before sql/101 is applied nothing is recorded.
 */
export async function setLineUnits(
  c: Context<AppEnv>,
  fn: 'sal_set_order_line_units' | 'pur_set_order_line_units',
  orderId: string,
  lines: { itemId: string; unit?: string }[],
): Promise<string | null> {
  const typed = lines.filter((l) => l.unit).map((l) => ({ itemId: l.itemId, unit: l.unit }));
  if (!typed.length) return null;
  try {
    await callRpc<void>(userDb(c), fn, { p_order_id: orderId, p_lines: typed });
    return null;
  } catch (err) {
    if (isMissingSchema(err)) return null;
    return (err as Error).message;
  }
}
