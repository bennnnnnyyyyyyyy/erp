// Attachments (sql/108, SCANNING_PLAN.md step 3): photos and PDFs on records. Same list as the database check on core_attachments.
export const ATTACHMENT_ENTITY_TYPES = [
  'supplier_bill',
  'purchase_order',
  'purchase_receipt',
  'sales_invoice',
  'sales_order',
  'customer',
  'supplier',
  'item',
  'expense',
] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];
export const ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type Attachment = {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  fileName: string | null;
  mime: string;
  bytes: number;
  sha256: string;
  uploadedBy: string;
  createdAt: string;
  /** A link that works for five minutes (private bucket). Null when it could not be made. */
  url: string | null;
};
