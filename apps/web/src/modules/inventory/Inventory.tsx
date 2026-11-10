// Inventory slice 1 screens. They call /v1/inventory/... : the real API in the real app, and the in-browser sample
// (lib/demoInventory.ts) in demo mode. Plan: documentation/plans/INVENTORY_PLAN.md.

// This file keeps the old import path working: the screens live in the files re-exported below.
export { useCatalog } from './inventoryShared';
export { EditItemModal } from './ItemModals';
export { StockPage } from './StockPage';
export { ReorderLevelsPage } from './ReorderLevelsPage';
export { ApprovalPoliciesPage } from './ApprovalPoliciesPage';
export { AdjustmentsPage } from './AdjustmentsPage';
export { RequestsList, NewRequest, RequestPage } from './RequestPages';
export { MOVE_KIND_LABEL, LedgerPage } from './LedgerPage';
