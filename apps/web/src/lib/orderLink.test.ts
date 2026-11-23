import { describe, expect, it } from 'vitest';
import { orderLink, readOrderLink } from './orderLink';

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
