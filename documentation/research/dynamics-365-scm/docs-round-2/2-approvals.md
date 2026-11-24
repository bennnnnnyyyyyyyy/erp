> **Round 2 (24 Nov 2026), part of [DOCS_ROUND_2.md](../DOCS_ROUND_2.md).** Read from Microsoft's public Dynamics 365 documentation
> (github.com/MicrosoftDocs/dynamics-365-unified-operations-public, licence CC BY 4.0, (c) Microsoft), downloaded on 24 Nov 2026.
> Our own words; only UI labels are quoted. Paths are relative to that repo's `articles/` folder. The download is kept locally
> in `.temp/d365-docs` (not in git).

# Round 2, topic 2: Approvals and workflow in Dynamics 365 Finance & SCM

Source: Microsoft public docs (CC-BY-4.0), downloaded to `.temp/d365-docs/articles`.
All paths below are relative to `articles/`. Every claim is **documented** (read in the docs),
not seen in a live system. The text is in our own words. Only short UI labels are quoted.

> **In short**
> - Dynamics has one shared "workflow" engine. Each document type (purchase order, requisition,
>   vendor invoice, journal, inventory journal) plugs into it. The same buttons appear everywhere:
>   **Submit**, **Approve**, **Reject**, **Request change**, **Delegate**, **Recall**, **Workflow history**.
> - The approver finds work in three places: the **Work items assigned to me** list, a **message bar**
>   on the record itself, and email. The mobile app adds a phone list with counts.
> - **By default the submitter CAN approve their own document.** A global setting
>   **Disallow approval by submitter** turns this off. It is **No** by default. This is the opposite of our rule.
> - Posting is blocked until approval: an inventory journal's **Post** button stays inactive; a vendor
>   invoice shows **Submit** instead of **Post**; a PO makes no inventory transactions before *Approved*.
> - Rules by amount are "conditions" on each approval step (for example, only run this step above 10,000).
>   Several approvers on one step can be "first one wins", majority, a percentage, or all.
> - Time limits per step, then an escalation path (person A, then B, then an automatic final action).
> - Delegation: one item, many items at once, or automatic rules for a date range ("out of office").
> - Change after approval: a changed PO goes back to *Draft* and needs re-approval; a policy decides
>   which field changes need it.

---

## 1. The building blocks

| Thing | What it does | Source |
|---|---|---|
| Workflow | A designed path for one document type. Has an owner, notification email template, submission instructions, and activation conditions (which workflow to use, for example by country). | `fin-ops-core/fin-ops/organization-administration/configure-workflow-properties.md` |
| Approval process | A group of approval steps. Has automatic actions, notifications, time limit, final approver, allowed actions. | `.../configure-approval-process-workflow.md` |
| Approval step | One step. Has a subject line, instructions, assignment, time limit, completion policy, condition, escalation. | `.../configure-approval-step-workflow.md` |
| Task (manual / automated) | Work that a person must do (for example check receipts), or that the system does (for example credit check, post invoice in batch). | `.../workflow-elements.md`, `finance/accounts-payable/vendor-invoices-overview.md` |
| Decision (manual / conditional) | A fork. A person picks Yes/No, or the system tests a condition. | `.../workflow-elements.md`, `.../workflow-actions.md` |
| Parallel activity | Two or more branches run at the same time. | `.../configure-parallel-activity-workflow.md` |
| Line-item workflow | Each line of a document can go to a different approver, by condition. | `.../configure-line-item-workflow.md`, `supply-chain/procurement/purchase-requisitions-workflow.md` |
| Versions | Each workflow has versions; only one is active. | `supply-chain/inventory/inventory-journal-workflow.md` |

Workflows run in a background queue (a batch job), not at the moment of the click.
Source: `fin-ops-core/dev-itpro/business-events/business-events-workflow.md`. **Documented.**

---

## 2. What the requester sees

| Moment | Behaviour | Source |
|---|---|---|
| Before submit | Record is *Draft*. A **Workflow** button is on the Action Pane. The message bar has an icon that shows submission instructions written by the admin. | `supply-chain/inventory/inventory-journal-workflow.md`, `.../configure-workflow-properties.md` |
| Submit | Requester picks **Workflow > Submit**. On a vendor invoice, **Submit** replaces **Post**. | `.../inventory-journal-workflow.md`, `finance/accounts-payable/vendor-invoices-overview.md` |
| Checks before submit | Vendor invoice can be refused at submit if totals differ, charges are not allocated, the invoice number is a duplicate, or quantity is below the receipt. The submitter gets an alert and fixes it. | `finance/accounts-payable/vendor-invoices-overview.md` |
| Status | PO with change management: *Draft*, *In review*, *Rejected*, *Approved*, *Confirmed*, *Finalized*. Requisition: *Draft*, *In review*, *Approved*, *Cancelled*, *Closed*; each line has its own status. | `supply-chain/procurement/purchase-order-approval-confirmation.md`, `supply-chain/procurement/purchase-requisitions-overview.md` |
| Invoice status in a workspace | *In process* (shows who must approve, pending time, due date), *Workflow failed*, *Workflow rejected* (shows the reason), *For my approvals*, then *Complete not posted*. | `finance/accounts-payable/vendor-invoice-workspace.md` |
| Recall | **Workflow > Recall** pulls the request back and resets the workflow. Record returns to *Draft* and can be edited. Recall covers the whole requisition, all lines. | `.../inventory-journal-workflow.md`, `supply-chain/procurement/purchase-requisitions-workflow.md` |
| Recall vs request change | These are different. After "request change" the requester may still be unable to add a line; then they must recall. | `supply-chain/procurement/purchase-requisitions-workflow.md` |
| Rejected | Workflow ends. Requester may edit and resubmit, or resubmit unchanged. Restart point is the start of the approval process. | `.../workflow-actions.md` |
| Change requested | Document goes back to the originator as a new work item. After resubmit, it goes again to the **first** approver. | `.../workflow-actions.md` |
| Notifications on reject | Requester gets two similar notices: one for the rejected item and one for the new "change requested" item. Microsoft lists this as a source of confusion. | `.../workflow-FAQ.md` |
| History | **Workflow history** page: instance ID, status, workflow and version, document, submit time, elapsed time, plus **Resume** and **Recall** buttons. Detail shows open work items and a tracking list of every step. | `fin-ops-core/fin-ops/organization-administration/tasks/view-workflow-history.md` |
| AI summary | Optional "Summary by Copilot" at the top of history: submitter, date, status, then the latest actions with who, when, comment. | `.../workflow-history-summary.md` |
| Stuck workflow | A workflow that fails hard gets status *Unrecoverable*. For journals and vendor invoices, **Recall** can reset it to *Draft* (feature switch). | `finance/general-ledger/general-journal-processing.md`, `finance/accounts-payable/vendor-invoices-overview.md` |

---

## 3. What the approver sees

### 3.1 Where the work appears

| Place | What it shows | Source |
|---|---|---|
| **Work items assigned to me** (list page and dashboard area) | All work items given to you; links to the record where you act. Multi-select to delegate many at once (feature switch, limited types). | `fin-ops-core/fin-ops/get-started/default-dashboard.md`, `.../tasks/delegate-work-items-workflow.md` |
| Message bar on the record | Shows the step's subject line (with placeholders such as amount, vendor). An icon opens the step instructions. | `.../configure-approval-step-workflow.md` |
| **Workflow** button on the record | Approve, Reject, and under More: Request change, Delegate, Recall, Workflow history. | `supply-chain/inventory/inventory-journal-workflow.md` |
| Workspace tiles | Vendor invoice workspace: "Journals - Assigned to me"; analytics such as assignments per approver and average days in workflow by approver. | `finance/accounts-payable/vendor-invoices-workspace.md` |
| Email | Built-in email per workflow event, from an email template. Each user picks grouped or one-per-line emails for line items. | `.../tasks/users-receive-workflow-related-email-messages.md`, `.../configure-workflow-properties.md` |
| Action center | Workflow emails do **not** create Action center messages today; Microsoft says this is planned. Power Automate on workflow business events can add other notices. | `.../workflow-FAQ.md`, `fin-ops-core/dev-itpro/business-events/business-events-workflow.md` |
| Mobile app | See section 7. | `supply-chain/approval-management-mobile-app/manage-approvals.md` |

### 3.2 Actions

| Role | Actions | Notes | Source |
|---|---|---|---|
| Approver | **Approve**, **Reject**, **Delegate**, **Request change** | Admin can switch each of the four off per approval process. | `.../workflow-actions.md`, `.../configure-approval-process-workflow.md` |
| Task assignee | **Complete**, **Reject**, **Delegate**, **Request change**, **Reassign**, **Release** | Reassign moves an item to another queue; Release gives an accepted item back to the queue. | `.../workflow-actions.md` |
| Decision maker | Choice 1 / Choice 2, or **Delegate** | | `.../workflow-actions.md` |
| Admin | **Reassign** a work item from the history page; **Resume** a stopped workflow | | `.../tasks/view-workflow-history.md` |

- **Comments.** Delegation asks for a comment. Notification text can include the last note from the
  previous step. Rejection reasons show in the invoice workspace. Source: `.../tasks/delegate-work-items-workflow.md`,
  `.../configure-workflow-properties.md`, `finance/accounts-payable/vendor-invoice-workspace.md`.
- **Request change goes only to the originator.** An older version let the approver pick the user;
  Microsoft removed that list as a security problem. Source: `fin-ops-core/fin-ops/get-started/removed-deprecated-features-platform-updates.md`.
- **Approver can edit.** On a vendor invoice in workflow, the approver may update quantities to match
  the receipt (feature switch). A purchasing agent may add missing data to a requisition. Source:
  `finance/accounts-payable/vendor-invoices-overview.md`, `supply-chain/procurement/purchase-requisitions-workflow.md`.
- **Delegate is "on behalf of".** The delegate acts as if they were the original person; the flow continues the same way.
  Source: `.../workflow-actions.md`.

---

## 4. Routing: who, how many, how much

| Feature | Behaviour | Source |
|---|---|---|
| Assign to | A role or group ("Participant"), a manager hierarchy, a user in this workflow (for example the submitter's manager), or named users. Requisitions add "expenditure reviewers" (project role or financial dimension owner). | `.../configure-approval-step-workflow.md`, `supply-chain/procurement/purchase-requisitions-workflow.md` |
| Hierarchy range | Walk up the hierarchy from a start person until a condition (for example a signing limit) is met; assign to all found, or only the last one; exclude some by condition. | `.../configure-approval-step-workflow.md` |
| Sequential | Steps follow each other. Step 2 starts after step 1 approves. | `.../workflow-actions.md` |
| Parallel | Parallel activity runs branches at the same time; line items can go to different people at the same time. | `.../configure-parallel-activity-workflow.md`, `supply-chain/procurement/purchase-requisitions-workflow.md` |
| Many people on one step | Completion policy: **Single approver** (first answer wins), **Majority of approvers**, **Percentage of approvers**, **All approvers**. One reject is enough to reject under "all". | `.../configure-approval-step-workflow.md` |
| Amount limits | Each step can run always or only when a condition is true (example in docs: requisition above 10,000). Journal workflows use limits on, for example, total debit. Requisitions route by spending / signing limits. | `.../configure-approval-step-workflow.md`, `finance/general-ledger/general-journal-processing.md`, `supply-chain/procurement/purchase-requisitions-workflow.md` |
| Auto-approve | "Automatic actions": if a condition is true, the system acts by itself (example: approve expenses under 100). Firmed planned POs are approved automatically. | `.../configure-approval-process-workflow.md`, `supply-chain/procurement/purchase-order-approval-confirmation.md` |
| Test a condition | A **Test** button checks a condition against a real record before saving. | `.../configure-approval-step-workflow.md` |
| Final approver | Extra approver added when the submitter also approved the document. | `.../configure-approval-process-workflow.md` |
| Per journal name | Inventory journals: one workflow per journal type, attached to a journal name with **Approval workflow = Yes**. Seven types incl. movement, transfer, counting, adjustment, BOM. Not for warehouse-module journals. | `supply-chain/inventory/inventory-journal-workflow.md` |

---

## 5. Time limits, escalation and delegation

| Feature | Behaviour | Source |
|---|---|---|
| Step time limit | Hours, days (with work calendar), weeks, a day in the month, or a day in the year. After it, the item is *overdue*. | `.../configure-approval-step-workflow.md` |
| Escalation path | Ordered list: give to person A; if A is late, give to B; at the end a final automatic action (for example Reject). Each level has its own time limit. | `.../configure-approval-step-workflow.md` |
| Process time limit | A limit on the whole approval process; overrides the step settings; when passed, the system takes a chosen action. | `.../configure-approval-process-workflow.md` |
| Delegate one item | **Workflow > Delegate**, pick a user, write a comment. | `.../tasks/delegate-work-items-workflow.md` |
| Delegate many | From **Work items assigned to me**, select items, **Delegate work items**, user and comment. Only for PO, purchase agreement, requisition, vendor invoice. Off by default. | `.../tasks/delegate-work-items-workflow.md` |
| Automatic delegation (away) | In **User options > Workflow**: rules with scope (all / one module / one workflow), delegate user, start and end date-time, enabled flag, comment. | `.../tasks/delegate-work-items-workflow.md` |
| Notifications on events | Per approval process: on Delegate, Escalate, Approve, Reject, Request change. Per workflow: Started, Stopped, Completed, Unrecoverable, Terminated. Text has placeholders and translations per language. Recipient: role, workflow user, or named users. | `.../configure-approval-process-workflow.md`, `.../configure-workflow-properties.md` |

---

## 6. What blocks posting, and re-approval after a change

| Document | Block | Source |
|---|---|---|
| Inventory journal | Cannot post until approved. **Post** button is inactive until then. | `supply-chain/inventory/inventory-journal-workflow.md` |
| Vendor invoice | **Submit** replaces **Post**. After approval: *Complete not posted*; posting can be an automated task in the workflow. | `finance/accounts-payable/vendor-invoices-overview.md`, `finance/accounts-payable/vendor-invoice-workspace.md` |
| Purchase order (change management on) | Starts *Draft*. No inventory transactions until *Approved*. Cannot be confirmed before approval. | `supply-chain/procurement/purchase-order-approval-confirmation.md` |
| General journal | Workflow with materiality limits; posting after approval. | `finance/general-ledger/general-journal-processing.md` |
| Change after approval (PO) | Use **Request change** on an approved PO: status back to *Draft*, edit, resubmit. A **Re-approval rule for purchase orders** policy lists which field changes need re-approval. Changing accounting distribution always resets it. | `supply-chain/procurement/purchase-order-approval-confirmation.md`, `supply-chain/procurement/purchase-policies.md` |
| Cancel under change management | Even a cancellation goes through approval before stock transactions update. | `supply-chain/procurement/purchase-order-approval-confirmation.md` |
| Vendor changes after confirmation | PO goes back to *Approved*. A workspace sorts changes into low impact and high impact (AI summary); buyer reconfirms in bulk. | `supply-chain/procurement/purchase-order-changes-after-confirmation.md` |

---

## 7. The mobile approvals app (phone)

Source for this section: `supply-chain/approval-management-mobile-app/manage-approvals.md`,
`.../approval-management-app-overview.md`, `.../approval-management-app-faq.md`. All **documented**.

| Screen | What it shows |
|---|---|
| Home | One tile per document type you may approve (Purchase orders, Purchase requisitions) with the **count** waiting for you. Search (order no., vendor, legal entity, item). Alerts with a red dot for new ones. Filter, sort, refresh (auto every 30 seconds). |
| List | One card per document or per line (a Header/Lines switch). Each card is a summary; a "view comments" link shows the requester's notes. |
| List with multi-select | Checkboxes, select all, and action buttons for **Approve / Reject / Delegate / Request change** on all selected. |
| Header detail | Tabs: Details, Attachments, **Timeline** (events on the document). Accounting distribution. Workflow instructions. Lines below. Action buttons at the bottom. |
| Line detail | Standard fields, an expandable "extra details", workflow instructions, action buttons (not on every line page). |

Facts about the app: needs a licence; runs inside Power Apps; access per security role per approval type;
no offline mode; no customisation; attachments only images, PDF and links; **no right-to-left languages yet**
(so no Arabic). It replaces an older PO approval mobile workspace.
The older vendor-invoice mobile design suggests showing about 8 header fields (vendor, total, number, dates,
currency) and 5 line fields, and designing for the common case (one line). Source: `finance/accounts-payable/mobile-invoice-approvals.md`.

---

## 8. Compared with our rules

| Topic | Dynamics | Us | Match? |
|---|---|---|---|
| Self-approval | Allowed by default. One global switch **Disallow approval by submitter** (default **No**). Optional "final approver" adds a second person. | Forbidden by default, enforced in the database. Exceptions: only one active owner/admin (flagged `self_decided`), or "owners may approve their own" switched on (off by default, audited). | **Differs. Ours is stricter.** Keep ours. Their switch is global; ours is per company and flagged per decision. |
| Where the block lives | Posting button inactive; status checks in the app. Docs do not say a database rule stops it. | Database function checks approval and approver ≠ requester. | Ours is stronger (not found in their docs). |
| One path for all channels | Mobile app and web call the same workflow actions. | In-app, WhatsApp, voice call the same function. | **Match** in idea. |
| Audit | Workflow history with tracking details per step, comments, times. | Append-only `audit_log` in the same transaction. | Similar for the user; ours is stricter. |
| Actions | Approve, Reject, Request change, Delegate, Recall. | Approve, Reject (comment). | We lack Request change, Delegate, Recall as named actions. |
| Rules by amount, multi-step, escalation | Full designer. | Not built. | Gap; may not be needed for small firms first. |
| Delegation while away | Date-range rules. | Not built. | Gap. A delegate must still not be the requester (Dynamics docs say nothing on this). |
| Re-approval after change | Policy decides which field changes reset approval. | Edit after approval: check our rules per document. | Worth a rule: any change to items/qty/warehouse resets to pending. |
| Inventory adjustments, transfers, counts | Optional workflow per journal name. | Always approval for outgoing stock. | Ours is always on; theirs is opt-in. |

---

## 9. What this means for our Approvals workspace screen

Ideas only. Pick in the Design Lab.

**Option A: workspace with counts + list + side panel** (closest to Dynamics)
- Top tiles with counts per type, like the mobile home: Stock requests, Adjustments, Transfers, Counts,
  Credit/debit notes. Add "Overdue" and "Waiting for others" (my own requests).
- List columns from Dynamics: document, type, requester, amount, **waiting time**, due date, step.
- Side panel: summary, lines, attachments, a **timeline** (submitted, viewed, decided), comment box,
  **Approve** / **Reject**. Put **Request change** under More later.
- When the viewer is the requester: show the item greyed with "You cannot approve your own request".
  If self-approval is allowed for this company, show a warning that it will be flagged.

**Option B: one request at a time (like WhatsApp)**
- Fits the mobile pattern: card, approve / reject / skip. Good for owners on a phone.
- Show the 5-8 most useful fields only (Dynamics advice: design for the common case).
- Add a "view all lines" link and the requester's comment, as in the mobile list.

**Option C: buttons in each list row**
- Dynamics only offers row-free bulk actions through multi-select (mobile and delegation list),
  not one-click buttons per row. Risk: approving without opening. If we build C, require the row
  to show amount and lines count, and ask for confirmation on reject (reason needed).

**Common to all options**
- A **message bar on the record** ("Waiting for approval by …", "Rejected: reason") on the request page.
- The **Post / Issue** button disabled until approved, with a reason on hover.
- **Recall** for the requester while still pending.
- Bulk approve with multi-select, but each decision is a separate audit row and a separate database call.
- Arabic: Dynamics mobile has no RTL; ours must.

**WhatsApp and voice**
- Message = the mobile card: type, number, requester, amount, top lines, requester comment, link to open.
- Replies: Approve, Reject (ask for a reason), maybe "Open in app". Delegation and change request stay in the app.
- Reminders = our version of escalation: re-send after N hours, then notify another owner/admin.
- Never offer the approve button to the requester on any channel.

---

## 10. Not found in the docs

- Any database-level block on posting without approval (docs talk only about buttons and statuses).
- Whether a delegate may be the original requester, or whether "Disallow approval by submitter"
  also covers delegates and escalation targets.
- Per-company (per legal entity) setting for self-approval; docs show it only as a workflow parameter.
- Microsoft Teams or Outlook "approve from the message" for workflow work items (Teams appears only
  for contacting vendors about PO changes). Power Automate is the suggested route.
- Push notifications on the phone (the app has an in-app alerts list; push not described).
- A screen picture we can describe for the web **Work items assigned to me** page columns.
- Mandatory reject reason (the invoice workspace shows a reason, but the docs do not say it is required).
- Approval of sales orders or stock issues outside inventory journals.
