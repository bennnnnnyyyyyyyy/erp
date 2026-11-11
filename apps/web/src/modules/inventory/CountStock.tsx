import { hasPermission } from '@erp/shared';
import { demoMode } from '../../lib/demo';
import { tr } from '../../lib/i18n';
import { useSession } from '../../session';
import { ActionCards, type ActionCard } from './ActionCards';

// "Count stock" (task-first Inventory, decision R1 A, 10 Nov 2026): check the shelves against the books. A whole warehouse, or one item.

export function CountStock() {
  const session = useSession();
  const can = (k: string) => hasPermission(session.permissions, k);
  const cards: ActionCard[] = [];
  if (!demoMode && can('inventory.adjustments.create')) cards.push({ key: 'wh', to: '/inventory/counts', title: tr('Count a whole warehouse'),
    text: tr('Every item is listed with what the books show. You type what you find. A manager approves the differences before stock changes.') });
  if (can('inventory.adjustments.create')) cards.push({ key: 'item', to: '/inventory/adjustments', title: tr('Count one item'),
    text: tr('Pick one item and one warehouse and type what is really there. A manager approves the difference before stock changes.') });
  return (
    <section className="page">
      <h1>{tr('Count stock')}</h1>
      <p className="muted">{tr('Check what is on the shelves against what the books say.')}</p>
      {cards.length === 0 ? <p className="notice">{tr('You do not have permission to count stock. Ask an owner or admin.')}</p> : <ActionCards cards={cards} label={tr('Ways to count stock')} />}
    </section>
  );
}
