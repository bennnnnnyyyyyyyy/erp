import { describe, expect, it } from 'vitest';
import { orderLink, readOrderLink, readTransferLink, transferLink } from './orderLink';

const ITEM = '11111111-2222-3333-4444-555555555555';
const SUP = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('order link (low stock pop-up)', () => {
  it('round-trips item, quantity and supplier', () => {
    const url = orderLink('/purchasing/orders/new', ITEM, 200, SUP);
    expect(readOrderLink(url.slice(url.indexOf('?')))).toEqual({ itemId: ITEM, qty: '200', partyId: SUP });
  });
  it('leaves the supplier empty when the item has none', () => {
    const url = orderLink('/purchasing/orders/new', ITEM, 12.5, null);
    expect(readOrderLink(url.slice(url.indexOf('?')))).toEqual({ itemId: ITEM, qty: '12.5', partyId: '' });
  });
  it('ignores bad values', () => {
    expect(readOrderLink('?item=abc&qty=-3&supplier=x')).toEqual({ itemId: '', qty: '', partyId: '' });
    expect(readOrderLink('')).toEqual({ itemId: '', qty: '', partyId: '' });
  });
});

describe('a transfer filled in from a sales order shortage', () => {
  const item = '0b6e1f0a-1111-4222-8333-944445555666';
  const giza = '1b6e1f0a-1111-4222-8333-944445555666';
  const main = '2b6e1f0a-1111-4222-8333-944445555666';
  it('round-trips item, quantity, from and to', () => {
    const link = transferLink(item, 2.5, giza, main);
    expect(link.startsWith('/inventory/transfers/new?')).toBe(true);
    expect(readTransferLink(link.slice(link.indexOf('?')))).toEqual({ itemId: item, qty: '2.5', fromId: giza, toId: main });
  });
  it('ignores bad warehouse ids', () => {
    expect(readTransferLink(`?item=${item}&from=x&to=`)).toEqual({ itemId: item, qty: '', fromId: '', toId: '' });
  });
});
