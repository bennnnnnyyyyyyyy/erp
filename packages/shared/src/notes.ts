// Notes on records (sql/113; Ben's decisions 25 Nov 2026): short text notes on a record. Anyone who can see the record reads its notes
// and (owners, admins, members) adds one; the writer deletes their own note, owners and admins delete any (a soft delete, audited).
// Same list as the database check on core_notes.
export const NOTE_ENTITY_TYPES = [
  'sales_order',
  'purchase_order',
  'sales_invoice',
  'supplier_bill',
  'item',
  'customer',
  'supplier',
  'expense',
  'payment',
  'stock_request',
  'stock_transfer',
  'stock_count',
  'task',
  'journal',
] as const;
export type NoteEntityType = (typeof NOTE_ENTITY_TYPES)[number];
export const NOTE_MAX_CHARS = 2000;

export type RecordNote = {
  id: string;
  entityType: NoteEntityType;
  entityId: string;
  body: string;
  createdBy: string;
  createdAt: string;
};
