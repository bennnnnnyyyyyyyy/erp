import { useState } from 'react';
import { hasPermission } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { tr } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { ActionCards, type ActionCard } from './ActionCards';
import { AddItemModal } from './ItemModals';
import { ReceiveBatchForm } from './ReceiveBatchForm';

// "Receive goods" (task-first Inventory, decision R1 A, 10 Nov 2026): stock comes in. Three ways, each said in plain words; every one is
// an existing screen or form, nothing here changes stock by itself.

type Item = { id: string; sku: string; name: string; tracksBatches: boolean };
type Named = { id: string; name: string };

export function ReceiveGoods() {
  const session = useSession();
  const can = (k: string) => hasPermission(session.permissions, k);
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<Named[]>('/v1/inventory/warehouses'));
  const [batchOpen, setBatchOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const fromOrder = session.modules.includes('purchasing') && can('purchasing.orders.receive');
  const asBatch = !demoMode && can('inventory.batches.receive');
  const openingStock = can('inventory.items.manage');

  if (!items.data || !warehouses.data) return <section className="page"><Loading error={items.error ?? warehouses.error} /></section>;

  const cards: ActionCard[] = [];
  if (fromOrder) cards.push({ key: 'po', to: '/purchasing/orders', title: tr('From a purchase order'),
    text: tr('Goods you ordered from a supplier. Open the order and press Receive: stock goes up as soon as you do.') });
  if (asBatch) cards.push({ key: 'batch', onClick: () => setBatchOpen(true), title: tr('A batch with an expiry date'),
    text: tr('For items tracked by batch (food, medicine). You enter the batch number and the expiry date here.') });
  if (openingStock && warehouses.data.length > 0) cards.push({ key: 'new', onClick: () => setAdding(true), title: tr('Opening stock for a new item'),
    text: tr('Add the item and say how many you already have. Stock goes up as soon as you save.') });

  return (
    <section className="page">
      <h1>{tr('Receive goods')}</h1>
      <p className="muted">{tr('Stock comes in. Choose how the goods arrived.')}</p>
      {cards.length === 0 ? <p className="notice">{tr('You do not have permission to receive goods. Ask an owner or admin.')}</p> : <ActionCards cards={cards} label={tr('Ways to receive goods')} />}
      {asBatch && <ReceiveBatchForm items={items.data} warehouses={warehouses.data} open={batchOpen} onOpenChange={setBatchOpen} />}
      {adding && <AddItemModal warehouses={warehouses.data} onClose={() => setAdding(false)} onDone={() => { setAdding(false); items.reload(); }} />}
    </section>
  );
}
