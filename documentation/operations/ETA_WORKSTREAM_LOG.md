# ETA e-invoicing work stream log

This is the worklog entry for the e-invoicing work stream, kept in its own file because the stream lives in a separate git worktree
(`eta-einvoicing`, branch `worktree-eta-einvoicing`) and the shared `WORKLOG.md`, `sql/README.md`, `sql/tests/README.md` and
`documentation/plans/checklist.md` have uncommitted edits in the main checkout. **Merged 3 Nov 2026: the entries and register rows below were copied into
`WORKLOG.md` (newest first) and add the register rows at the bottom of this file to the two READMEs and the checklist.**
Plan: [`../plans/ETA_EINVOICING_PLAN.md`](../plans/ETA_EINVOICING_PLAN.md), section 14.

## 2026-11-03 — E-invoicing slice A, document builder, ETA client (overnight; not deployed, SQL not applied)

**Objective.** Ben asked to "work on ETA through the night". Do everything that needs neither ETA access nor a business decision:
the tax master data, credit and debit notes with approval, the document builder and canonical serializer tested against ETA's own sample
files, and an ETA HTTP client with a fake network. Not deployed before the Wednesday demo (4 Nov).

**Actions Completed.**
- `packages/shared/src/modules/einvoicing/`: exact decimal arithmetic (bigint, 5 places, half away from zero, default 2 places), JSON that
  keeps number text, ETA canonical serializer and SHA-256 digest, line and document calculation, document builder (invoice, credit,
  debit; v1.0 and v0.9), mapping from our invoice (EGP only), pre-flight validation and credit-note rules, signer interface with a test stub.
  **Verified against the SDK's own files:** the serializer output equals `one-doc-serialized.json.txt` byte for byte, and the arithmetic
  reproduces both lines and all totals of `one-doc.json`.
- `apps/api/src/lib/eta/client.ts`: login with an hour-long token cache and one shared login for concurrent callers, submit (exact body
  text), get submission, cancel, reject, document type; typed errors with correlation id, `Retry-After`, retryable flag; one retry after a
  401, never a loop. `callback.ts`: ApiKey check (constant time) and notification parsing (`deliveryId`, batch cap). Tests use a fake
  network; **nothing was sent to ETA**.
- `sql/036_einvoicing_tax_data.sql` (tax profile, branches, per-company tax rates, ETA subtype and unit code tables, customer tax identity,
  item ETA codes and default rate; module `einvoicing` off by default; audit rows; select-only grants; column grant on `inv_items`) and
  `sql/037_credit_debit_notes.sql` (notes, lines, append-only approvals; a credit note can never credit more than was invoiced; a
  requester cannot approve their own note in the function and in a check constraint; an invoice with open or approved notes cannot be
  voided). Tests `sql/tests/030` and `031`.
- API: `/v1/einvoicing/*` and `/v1/sales/notes*` routes (all behind a permission), reason codes `IN_USE`, `NOTE_EXCEEDS_INVOICE`,
  `ACTIVE_NOTES` and a 409 for unique-index duplicates in `apps/api/src/lib/rpc.ts`; module `einvoicing` and permissions
  `einvoicing.settings.{read,manage}`, `sales.notes.{read,create,approve}` in `packages/shared/src/modules.ts`.
- Found by comparing with ETA's working examples and recorded in the plan (section 14): working-example field casing (`internalID`,
  `branchID`, `"I"`, `signatureType`), 2-decimal rounding in the sample, the confirmed VAT/total equations, the duplicate `ST` unit code.

**Database / System Result.** Dry runs against the live project (project `ggoerp`) in one rolled-back transaction per migration:
036 plus test 030, and 037 plus test 031, each ended with "ALL TESTS PASSED (everything rolled back)". The first 036 run failed (the
new item columns were not readable by signed-in users because `inv_items` uses column grants, sql/023); fixed with an explicit column
grant and a test, then passed. Two deliberate breakages of 037 (remove the cumulative credit cap; remove the self-approval check) were
each caught by the test. After the dry runs a read-only query confirmed none of the new tables or columns exists on the live project.
**The migrations are NOT applied.** Local checks: `npm run typecheck` clean; shared tests 31 passed (including the SDK vector, which
needs `ETA_SDK_DIR` pointing at the offline SDK `files/files` folder, otherwise that one test is skipped); API tests 86 passed.

**Safety Status.** Nothing deployed, nothing committed, no secret written anywhere (the ETA client takes credentials in memory only;
no storage exists yet). No ETA call was made. Approved credit notes do **not** yet reduce owed, receivables or revenue figures. No screens
exist. The client, the callback parser and the builder are checked against the documentation and SDK samples, not against ETA. Applying
036 and 037 needs Ben's yes (dry run first, then `supabase db query --linked -f`, then tests 030 and 031 on the live project).
The worktree's `node_modules` is a set of junctions into the main checkout's `node_modules` (with `@erp/*` pointing at the worktree);
remove it before deleting the worktree (it is not tracked).

## 2026-11-03 (later) — One EtaTransport, simulated by default, production refused (Ben's instruction)

**Objective.** Put every ETA call behind one `EtaTransport` interface with a Simulated and a Real implementation; per-company mode
(simulated | preprod | production, default simulated); one contract suite for both; simulated sends carry a visible badge and store no
real ETA reference; production refused without credentials and a real signer.

**Actions Completed.** `apps/api/src/lib/eta/transport.ts` (interface, `EtaError`, `transportFor()` with refusals), `simulated.ts` (scenarios
accepted, rejected, pending; duplicate window; cancel and reject rules; no network), `client.ts` now implements the interface (`simulated: false`).
Shared `mode.ts` (modes, `SIMULATED_BADGE`, `toSendRecord`, `recordIsConsistent`), `Signer.kind` (`real` | `stub`). `sql/036` changed before it was
ever applied: `tax_profiles.eta_environment` became `eta_mode` (default `simulated`), `eta_save_profile(..., p_mode)` refuses `production`
(`PRODUCTION_NOT_READY`) and audits mode changes; test 030 rewritten for it. API: profile route takes `mode`; reason code mapped.
Tests: `eta_transport.contract.ts` + `eta_transport.test.ts` (31 tests: 24 run, 7 PreProd skipped without credentials).

**Database / System Result.** 036 + 037 + tests 030 and 031 dry-run again (rolled back): ALL TESTS PASSED; live project unchanged (0 new
tables or functions). Typecheck clean; shared 31, API 110 passed + 7 skipped. A deliberate break of the simulator failed the contract.

**Safety Status.** Still nothing deployed, committed or applied. The real client and the PreProd contract have never run against ETA. No screen
shows the badge yet. Production cannot be selected in the database or built by the factory without credentials and a real signer.
## Register rows to add at merge

`sql/README.md` migration table:

| `036_einvoicing_tax_data.sql` | e-invoicing tax master data: tax profile, branches, tax rates, ETA subtype and unit tables, customer tax identity, item ETA codes (module `einvoicing`, off by default) | Written, dry-run tested 2026-11-03; **not applied** |
| `037_credit_debit_notes.sql` | credit and debit notes with approval; credit never above invoiced; invoice with active notes cannot be voided | Written, dry-run tested 2026-11-03; **not applied** |

`sql/tests/README.md`:

| `030_einvoicing_tax_data.sql` | module switch, roles, ETA code pairs, EGS code format, default rate uniqueness, soft delete and in-use guard, customer and item fields, audit, no direct writes, other organization (needs 036) |
| `031_credit_debit_notes.sql` | who requests and decides, credit cap per line and cumulative, debit notes, self-approval blocked in function and data, reject and cancel free the quantity, void blocked with active notes, immutability, other organization (needs 037) |

`documentation/plans/checklist.md`: module "E-invoicing (Egypt)": slice A1 and A2 written and dry-run tested (not applied); document builder, serializer and
ETA client tested offline; screens, credential storage, callbacks, queue, signing, finance integration not started.
