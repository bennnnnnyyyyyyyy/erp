# ADR-0005: VAT is computed and stored on each document line, once

**Status:** Accepted (with [VAT_PLAN.md](../../plans/VAT_PLAN.md), approved by Ben 16 Nov 2026); part 1 implemented in `sql/086`
**Date:** 2026-11-16
**Deciders:** Ben

## Context

Before VAT, an invoice's total was recomputed from quantity × price in about 15 places (API, web, SQL). Adding tax to each would
multiply the places where a rounding or a rule can differ, and a later rate change would silently change old documents.

## Decision

The database function that creates an invoice, bill or note computes each line's net, tax rate (copied) and tax, and the document's
net, tax and gross, and stores them. A trigger on the line tables applies the one rule (net = round(qty × price); tax =
round(net × rate / 100), half away from zero, per line) whatever writes the line; invoice totals are rolled up from their lines and
cannot be edited. Everything else (posting, amount owed, reports, screens, ETA) reads the stored figures. Issued documents are never
recomputed; corrections are notes or reversing entries. Prices are entered before VAT (ETA style); documents issued before VAT keep
zero tax.

## Consequences

- One place for the maths; past documents keep their tax when rates change; the ETA submission can read the same numbers the ledger posted.
- The migration backfilled existing documents (zero tax) and switched every recomputation of the amount owed to the stored totals
  (`sal__invoice_owed`: gross − approved credit notes + approved debit notes − payments).
- A screen that previews a line before saving uses the same rule from `packages/shared/src/vat.ts` (tested against the ETA calculator);
  the database remains the judge.
- Supplier bills follow in part 2 (`sql/087`), the VAT summary in part 3.

## Alternatives considered

- **Compute tax wherever a total is shown** (as totals were before): rejected; many places to keep in step, and old documents would
  change with a rate.
- **Prices that include VAT**: deferred (plan section 4); a per-company switch can come later without changing this decision.
- **Store only document totals, not line figures**: rejected; ETA documents and credit notes need the tax per line.
