// What to do when an action is blocked (Ben, 25 Nov 2026: one helper for every error). The server's message says what is wrong; this
// says what unblocks it and, where a page does, which page. Used by lib/api.ts for every error: the sentence is added to the message
// every screen already shows, and the link is offered once, in the bar the Shell shows (components/NextStepBar.tsx), only when the
// person can open that page. Codes come from apps/api/src/lib/rpc.ts and middleware/tenant.ts.

export type NextStep = { text: string; to?: string; label?: string };

export const NEXT_STEPS: Record<string, NextStep> = {
  period_locked: { text: 'Change the date, or ask an owner to move the lock date (Settings → General).', to: '/settings', label: 'Settings' },
  module_disabled: { text: 'An owner can switch the app on in Settings → Apps.', to: '/settings/apps', label: 'Apps' },
  account_role_missing: { text: 'Choose the missing account in Accounting setup.', to: '/accounting/setup', label: 'Accounting setup' },
  receipt_cost_required: { text: 'Enter the missing receipt costs in Accounting setup.', to: '/accounting/setup', label: 'Accounting setup' },
  uncosted_receipts: { text: 'Enter the missing receipt costs in Accounting setup.', to: '/accounting/setup', label: 'Accounting setup' },
  treasury_account_required: { text: 'Choose a cash box or bank account, or add one in Treasury.', to: '/treasury', label: 'Cash and banks' },
  insufficient_available: { text: 'Receive goods, or move stock here from another warehouse.', to: '/inventory/receive', label: 'Receive goods' },
  batch_stock_short: { text: 'Check the batches: quarantined and expired ones cannot move.', to: '/inventory/batches', label: 'Batches and expiry' },
  storage_mismatch: { text: "Check the item's storage needs and the warehouse's storage places.", to: '/inventory/settings', label: 'Inventory settings' },
  vat_rate_missing: { text: 'An owner chooses the default VAT rate in Settings.', to: '/settings', label: 'Settings' },
  not_delivered: { text: 'Deliver the order first: its stock request must be issued.', to: '/sales/orders', label: 'Sales orders' },
  invoice_qty_exceeds_delivered: { text: 'Deliver the order first: its stock request must be issued.', to: '/sales/orders', label: 'Sales orders' },
  bill_qty_exceeds_received: { text: 'Receive the goods on the purchase order first.', to: '/purchasing/orders', label: 'Purchase orders' },
  self_approval: { text: 'Another owner or admin must approve it.' },
  count_incomplete: { text: 'Enter a counted quantity on every line, then try again.' },
  // Not a server error: the ETA print layout's own check (sales/print/PrintDocument.tsx) when the company's tax registration or branch
  // address is missing (Ben, 25 Nov 2026: Settings → E-invoicing).
  eta_company_missing: { text: 'Enter the company tax registration and branch address in Settings → E-invoicing.', to: '/settings/einvoicing', label: 'E-invoicing' },
};

/** The next step for an error code, or undefined. */
export const nextStepFor = (code?: string): NextStep | undefined => (code ? NEXT_STEPS[code] : undefined);

/** The event the Shell listens to, to offer the link. */
export const NEXT_STEP_EVENT = 'erp:next-step';
