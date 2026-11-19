import { api } from './api';
import { demoMode } from './demo';
import type { ItemDefaultUnits, ItemUnit } from './lineUnits';
import { useLoad } from './useLoad';

/** Every item's units and default units (one call; slice D). Empty in the demo build or when the server has no units yet. */
export function useItemUnits() {
  return useLoad(() =>
    demoMode
      ? Promise.resolve({ units: [] as ItemUnit[], defaults: [] as ItemDefaultUnits[] })
      : api<{ units: ItemUnit[]; defaults: ItemDefaultUnits[] }>('/v1/inventory/item-units').catch(() => ({
          units: [] as ItemUnit[],
          defaults: [] as ItemDefaultUnits[],
        })),
  );
}
