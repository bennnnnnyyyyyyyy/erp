// Ordered / delivered / invoiced per sales order line, and a flag for whatever does not match.
// Delivery is all-or-nothing today: an order is delivered once its stock request is issued, then every line is delivered.

export type BillingFlag = 'ok' | 'not_delivered' | 'under_invoiced' | 'over_invoiced';

export type BillingLine = {
  orderLineId: string;
  itemId: string;
  ordered: number;
  delivered: number;
  invoiced: number;
  flag: BillingFlag;
};

export function billingFor(
  lines: { orderLineId: string; itemId: string; qty: number }[],
  requestStatus: string | null,
  invoicedByLine: Map<string, number>,
): BillingLine[] {
  const delivered = requestStatus === 'issued';
  return lines.map((l) => {
    const d = delivered ? l.qty : 0;
    const invoiced = invoicedByLine.get(l.orderLineId) ?? 0;
    const flag: BillingFlag = invoiced > d ? 'over_invoiced' : d === 0 ? 'not_delivered' : invoiced < d ? 'under_invoiced' : 'ok';
    return { orderLineId: l.orderLineId, itemId: l.itemId, ordered: l.qty, delivered: d, invoiced, flag };
  });
}
