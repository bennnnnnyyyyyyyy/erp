import { demoMode } from '../../lib/demo';
import { tr } from '../../lib/i18n';
import type { ActionCard } from './ActionCards';

/** The five things people come to Inventory to do (task-first Inventory, decision R1 A, 10 Nov 2026), each shown only if this person may do it. */
export function overviewActions(can: (permission: string) => boolean, hasPurchasing: boolean): ActionCard[] {
  const cards: ActionCard[] = [];
  const receive = (hasPurchasing && can('purchasing.orders.receive')) || can('inventory.items.manage') || (!demoMode && can('inventory.batches.receive'));
  if (receive) cards.push({ key: 'receive', to: '/inventory/receive', title: tr('Receive goods'),
    text: tr('Stock comes in. From a purchase order, as a batch with an expiry date, or as opening stock for a new item.') });
  if (can('inventory.request.create')) cards.push({ key: 'send', to: '/inventory/requests/new', title: tr('Send goods out'),
    text: tr('Stock leaves the warehouse. Your manager approves it before the goods leave.') });
  if (can('inventory.transfers.create')) cards.push({ key: 'move', to: '/inventory/transfers/new', title: tr('Move between warehouses'),
    text: tr('Send stock from one warehouse to another. It is approved first, then received at the other end.') });
  if (can('inventory.adjustments.create')) cards.push({ key: 'count', to: '/inventory/count', title: tr('Count stock'),
    text: tr('Check the shelves against the books: a whole warehouse, or one item.') });
  if (can('inventory.adjustments.create')) cards.push({ key: 'correct', to: '/inventory/adjustments', title: tr('Correct a quantity'),
    text: tr('The books say one number; type what is really there. A manager approves the difference.') });
  return cards;
}
