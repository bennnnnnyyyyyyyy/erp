import { describe, expect, it } from 'vitest';
import { appDepth } from '../../lib/router';
import { shortagesFor } from './shortage';

describe('not enough stock to deliver a sales order', () => {
  const stock = [
    { itemId: 'oil', warehouseId: 'main', available: 4 },
    { itemId: 'oil', warehouseId: 'giza', available: 10 },
    { itemId: 'rice', warehouseId: 'main', available: 50 },
  ];

  it('lists only what is short in the order warehouse, adding up lines of the same item', () => {
    const s = shortagesFor([{ itemId: 'oil', qty: 3 }, { itemId: 'oil', qty: 3 }, { itemId: 'rice', qty: 20 }], 'main', stock);
    expect(s).toEqual([{ itemId: 'oil', need: 6, available: 4, short: 2, elsewhere: [{ warehouseId: 'giza', available: 10 }] }]);
  });

  it('an item with no stock at all is short by the whole quantity and has nowhere to move from', () => {
    expect(shortagesFor([{ itemId: 'sugar', qty: 5 }], 'main', stock)).toEqual([{ itemId: 'sugar', need: 5, available: 0, short: 5, elsewhere: [] }]);
  });

  it('nothing is short when the warehouse has enough', () => {
    expect(shortagesFor([{ itemId: 'rice', qty: 50 }], 'main', stock)).toEqual([]);
  });
});

describe('Back returns where the person came from', () => {
  it('counts only pages opened inside the app', () => {
    expect(appDepth(null)).toBe(0); // opened from a QR code, a link or a reload
    expect(appDepth({ erpDepth: 2 })).toBe(2);
    expect(appDepth({ other: 1 })).toBe(0);
  });
});
