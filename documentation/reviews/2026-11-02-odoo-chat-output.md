# Odoo chat: final output (recovered)

> Recovered verbatim from Claude Code session transcript f0f76697-1d1c-4763-8adf-a7876c06a20f (2026-11-02), the last assistant message before the chat lagged out.

---

Cleanup, audit and Odoo comparison are done. I haven't scanned your Odoo trial yet. No commits and no code changes.

## Are we missing apps?
Yes. Against Odoo, we're missing:

- **Manufacturing.** The workbook marks it as a decision. Without it, the cosmetics sample's profit stays approximate.
- **Barcode scanning.** The workbook says P2, but for warehouse staff on phones I'd make it P1.
- **PDF printing** of delivery slips and invoices.
- **CSV import.** This is how a customer actually gets their items in.
- **ETA e-invoicing.** Needs a management decision.

CRM, HR, POS and similar are deliberately out of scope.

We also have no inter-warehouse transfers, no returns or credit notes, no product categories, and no unit conversions. These aren't among your 64 rows at all. I'd add inter-warehouse transfers, returns, and units/categories as P1.

## Odoo P1 gap (your 64-row tab 9 against our code)
- **7 of 23 P1 rows are only Partial:**
  - operation types
  - quotations
  - payments and reconciliation
  - activities and chatter
  - WhatsApp (needs your Meta account and a real-phone test)
  - automated actions
  - Arabic and RTL
- **Two workbook rows overstate what's built.**
  - "Locations" is marked Built, but we only have warehouses, with no bins or shelves.
  - "Credit notes" is marked Built, but invoices can only be voided.
  - Counting those two, **9 of 23 P1 rows aren't fully built.**
- **CSV:** the workbook says No, but list screens already export CSV. Only import is missing.

Full table: `documentation/research/odoo/P1_GAP.md`. Odoo's behaviour there is still unconfirmed until your trial results are in.

## UI audit
This was a code-level audit, with no browser used. Details are in `documentation/reviews/2026-11-02-ui-audit.md`.

1. **High:** only the menu bar is translatable. The other 38 of 40 screen files are hard-coded English, so an Arabic company gets Arabic menus and an English app. That breaks your own multi-language rule.
2. **High:** dates and month names on the home pages are English-only.
3. **Medium:** a single 642 kB JavaScript file loads on first visit, with no code-splitting.
4. **Medium:** buttons are 32–36 px high, below the usual 44 px for thumbs.
5. **Medium:** list screens only have search, sort and CSV. This is most of why it feels basic next to Odoo: there are no filters, grouping, saved views or pagination.
6. **Medium:** the component kit is only Button and Badge.
7. **Low:** two native browser pop-ups confirm destructive actions, and there's no skip-to-content link.

**Fixed:** nothing. The translation work needs your decision because the Arabic needs a native-speaker review. Everything else is either visual, so I can't verify it without a browser, or feature work. Code-splitting is safe and I can verify it with the build, so I can do it next if you want.

**Clean:** the layout code uses no left/right-specific CSS (RTL-safe), there are no hard-coded colors, focus rings exist, and typecheck and tests pass.

## Cleanup
- **Moved to `_to_delete/`:** the patch, `gpreport.html`, `test.ps1` and `test dump.md`.
- **Left alone:** `reply.md`, `migration.md`, `skills-lock.json`, `temp\`, and your v12 workbook. The v10 workbook was already gone.
- **Worktree:** the branch was already merged and clean, so I unregistered it and deleted the local branch. The folder `.claude/worktrees/security-audit-fixes` is still on disk because git said "Directory not empty", probably `node_modules`. The remote branch is untouched.
- **Worklog:** updated.

## Filling the workbook
Tab 9, column F ("Seen in your trial?"), is where your Odoo trial results go. For each row, search for the feature in your trial's Apps list and Settings, then answer **Yes**, **No** or **Not on plan**. "Not on plan" is a useful answer: it tells us what a customer on the cheaper tier can't get. Do tab 8 first. It has 16 checks, and the most valuable are:

- Validate a transfer, to see whether any approval is possible.
- Test the Approvals app, to see whether it can gate stock.
- Check the WhatsApp app, to see who it can message.
- Check Egypt e-invoicing availability.

Name screenshots `odoo_area_what` and log them in tab 7. Also add the 8 candidate rows from section 3 of `P1_GAP.md` to tab 9. I haven't edited your workbook, so I don't risk breaking its formatting or dropdowns.

## Decisions for you
1. **Odoo trial:** do you want me to look through it? You offered, and I'd keep it to read-only viewing of the Apps list and Settings for tab 8. The catch is that `research/README.md` says no "scraping behind logins", so a light look is fine but I wouldn't crawl it. I'd need Chrome connected and your trial open in a tab.
2. **Translation:** should I start translating every screen (Arabic text drafted, flagged for native review)? Or leave the screens in English for now and do the Odoo-driven features first?
3. **Code-splitting:** want me to do it?

Not yet done: the 64-feature list isn't a separate message from you, so I used tab 9. If it differs, send it and I'll redo the comparison.
