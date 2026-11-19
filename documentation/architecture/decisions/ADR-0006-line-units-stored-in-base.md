# ADR-0006: Order lines stay in the base unit and remember the unit they were typed in

**Status:** Accepted (Ben, 19 Nov 2026, with [MASTER_DATA_PLAN.md](../../plans/MASTER_DATA_PLAN.md) slice D); implemented in `sql/101`
**Date:** 2026-11-19
**Deciders:** Ben

## Context

Companies buy and sell in other units than they count stock in: a box of 12, a carton of 24, a drum of 25 kg. Units per item with a
factor exist since `sql/044`, but no document used them. The master data plan first proposed that each document line keep its own
unit, quantity and price (3 box at 120.00) and that stock move in base units. That changes every function that writes, invoices, taxes
or posts a line: about fifteen database functions across sales invoices, credit and debit notes, supplier bills, VAT and accounting.

## Decision

A line is stored exactly as before, in the item's base unit: the quantity in pieces and the price per piece. Invoicing, VAT, stock,
average cost and accounting read it unchanged. Order lines (`sal_order_lines`, `pur_order_lines`) also store the unit they were typed
in and its factor (`unit`, `unit_factor`; null = the base unit). Screens and printed documents show "3 box (36 piece)" and the price per
box. Each item may have a default buying unit and a default selling unit that new lines start in.

Prices come from the piece price (Ben, 19 Nov): a box line suggests piece price × factor. When a price typed per box does not split into
whole minor units per piece (100.00 for a box of 12 = 8.333 a piece), the piece price is rounded (8.33) and the line becomes 99.96; the
order screen shows this before saving. Only whole pieces: unless the base unit is a measure (kg, litre, metre…), a typed quantity must
come to a whole number of base units (1.5 boxes of 12 = 18 is fine, 1.3 = 15.6 is refused).

## Consequences

- No change to issued-document maths, VAT (ADR-0005), posting or the ledger; existing lines simply have no unit (the base unit).
- A box price that does not divide evenly can differ from the line by a few minor units; the person sees the saved amount first.
- Invoices, bills and notes show the unit of the order line they come from; they are not typed in another unit themselves.
- Supplier last prices (`sql/097`) stay per base unit.
- The unit is recorded right after the order is created, in a second call (`sal_set_order_line_units` / `pur_set_order_line_units`).
  If that call fails, the order stays in base units with correct quantities and prices, and the API says why.

## Alternatives considered

- **Each line keeps its own unit, quantity and price (the plan's first idea).** Exact box prices, but every posting function changes
  and every document total is recomputed differently; rejected by Ben on 19 Nov as too large and risky for the benefit.
- **Price per unit in price lists.** A separate box price per item and list; more setup; not chosen (prices come from the piece price).
