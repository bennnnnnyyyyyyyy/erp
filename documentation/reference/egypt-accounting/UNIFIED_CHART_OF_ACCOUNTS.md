# Egyptian Unified Accounting System: chart of accounts (research note)

**Written:** 2026-11-05 by Claude, for phase 1 of
[`ROADMAP_ACCOUNTING_SUITE.md`](../../plans/ROADMAP_ACCOUNTING_SUITE.md) (Q3: Egypt first, unified
chart as the default template).
**Status:** Partial. The top two levels of groups 1 and 2 are documented; groups 3 and 4 are
incomplete. **The official text was not found online.** Confirm with the pilot accountant (Q4) before
the seed template is final.

**Evidence labels:**
- *documented* means a secondary source states it, with a link;
- *unconfirmed* means we have no source yet.

Nothing here is from memory.

## 1. Legal basis

- Issued by **Presidential Decree 4723 of 1966**. Amendments are issued by the **Central Auditing
  Organization** (الجهاز المركزي للمحاسبات), on proposals from a permanent technical committee.
  *documented* ([AAM][aam]; search summary also cites this).
- It covers the fiscal year, the chart of accounts and the final statements, and requires the
  accrual basis. *documented* ([AAM][aam]).
- It was written for the public sector. Private companies in Egypt follow the **Egyptian Accounting
  Standards (EAS)** for their statements. Many use a chart shaped like the unified one, but that is
  practice, not law. *unconfirmed*: ask the pilot accountant.

## 2. Structure (Egyptian version)

Codes are hierarchical: one digit per group, two digits per sub-group, and further levels below for
each company's own detail. *documented* ([AAM][aam]).

| Code | Arabic | English | Label |
|---|---|---|---|
| **1** | الأصول | Assets | documented |
| 11 | أصول ثابتة | Fixed assets | documented |
| 12 | مشروعات تحت التنفيذ | Projects under construction | documented |
| 13 | استثمارات طويلة الأجل | Long-term investments | documented |
| 14 | قروض وأرصدة مدينة طويلة الأجل | Long-term loans and receivables | documented |
| 15 | أصول أخرى | Other assets | documented |
| 16 | مخزون | Inventory | documented |
| 17 | عملاء وأوراق قبض | Customers and notes receivable | documented |
| 18 | استثمارات مالية متداولة | Current financial investments | documented |
| 19 | نقدية بالبنوك والصندوق | Cash at banks and on hand | documented |
| **2** | حقوق الملكية والالتزامات | Equity and liabilities | documented |
| 21 | رأس المال المدفوع | Paid-up capital | documented |
| 22 | الاحتياطيات | Reserves | documented |
| 23 | الأرباح (الخسائر) المرحلة | Retained earnings (losses) | documented |
| 24 | (أسهم خزينة) | (Treasury shares) | documented |
| 25 | التزامات طويلة الأجل | Long-term liabilities | documented |
| 26 | مخصصات | Provisions | documented |
| 27 | بنوك دائنة | Bank overdrafts | documented |
| 28 | موردون وأوراق دفع وحسابات دائنة | Suppliers, notes payable and payables | documented |
| **3** | التكاليف والمصروفات | Costs and expenses | documented |
| 31 | خامات ومواد ووقود وقطع غيار | Raw materials, supplies, fuel, spare parts | documented |
| 32 | أجور | Wages | documented |
| 33 | مصروفات | Expenses | documented |
| 34+ | ? | Purchases for resale, depreciation, transfers… | **unconfirmed** |
| **4** | الإيرادات | Revenues | documented |
| 41+ | ? | Sales revenue, other income… | **unconfirmed** |

## 3. Source rule

Only Egyptian sources are used for this note (Ben, 5 Nov). Many Arabic search results describe other
countries' "unified" systems, with different groups and codes; they are left out, as are vendor and
blog sample charts.

## 4. What this means for the product (input to the phase 1 plan, not decided)

- Seed a company's chart from this structure: the documented group and sub-group codes, plus a
  third level with the accounts our documents post to. For example:
  - stock under 16;
  - customers under 17;
  - cash and bank under 19;
  - suppliers under 28;
  - VAT accounts under 28 or 26, to be confirmed in phase 3.
- Every level stays editable, and a company may add codes below any level.
- Groups 3 and 4 and the third level need confirming with the pilot accountant, ideally from the
  chart they use in Miracle (export or printout with made-up figures).

## 6. Open questions for the accountant

1. Does your company use the unified chart's codes, or its own?
2. What are the sub-groups under 3 (costs and expenses) and 4 (revenues) that you use?
3. Where do VAT (input and output), withholding tax and stamp duty sit?
4. Where do cheques under collection and post-dated cheques sit?

## Sources

- [aam]: Arab Academy for Management, "مقدمة في النظام المحاسبي الموحد":
  https://www.aam-web.com/ar/department_detail/30

[aam]: https://www.aam-web.com/ar/department_detail/30
