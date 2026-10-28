# Building our own ERP: the plan, and what we need from you

**For:** Management | **Date:** 28 October 2026 | **Status:** Proposal for decision

You asked us to look at the competition and find where they fall short. This is what we found, the product we propose to build because of it, and the decisions we need from you to go ahead.

---

## 1. Where we are

We reviewed nine ERP systems used by small and mid-size businesses that hold stock in Egypt and the Gulf. The research uses public sources only (vendor sites, review sites, partner pages). We have not yet tried the products hands-on, and we have not yet asked a single customer.

## 2. What competitors do badly

| Problem we found | Who has it | Why it matters to a customer |
|---|---|---|
| **No staff approvals or tasks by WhatsApp or voice.** WhatsApp is only used to send documents *to customers*. | All nine | Managers approve stock leaving the warehouse on paper, by phone call or by WhatsApp today, outside the system. The ERP never knows. |
| **Approvals that may not truly stop the stock.** Odoo has no built-in manager approval on stock transfers (paid add-ons). Edara has transfer approvals, but we have not confirmed that the stock is really held. | Odoo, Edara, others | An approval that can be bypassed is a checkbox, not a control. |
| **Weak or missing change history.** Edara shows only deleted documents. We found no change log at Daftra or Wafeq. | Edara, Daftra, Wafeq | When stock goes missing, nobody can show who changed what. |
| **Prices in dollars or hidden.** Only Wafeq shows Egyptian pound prices. Edara, Zoho and NetSuite want a quote. | Almost everyone | Egyptian customers cannot easily budget, and the exchange rate hurts them. |
| **Warehouse features locked behind higher plans or paid add-ons.** | Wafeq (top plan), Zoho (premium tier), Odoo (add-ons) | A small business pays for a tier it does not otherwise need. |
| **Weak mobile apps and Arabic.** Reviewers complain about Edara's mobile. Zoho's Arabic is not well tuned. We found no Egyptian-dialect voice at all. | Edara, Zoho, NetSuite | Warehouse staff work on phones, in Arabic. |
| **Heavy, expensive setup.** | Odoo, ERPNext, SAP, NetSuite | Implementation can cost thousands to over a hundred thousand dollars. A small business cannot afford it. |

What is **not** a gap: approvals, audit logs and AI-with-approval already exist in several products, and Edara and Daftra already handle Egyptian e-invoicing. Being cheap is also not a gap: local prices are already low, around USD 35-70 a month for a small team.

## 3. What we propose to build

A **warehouse-first ERP for Egyptian and Gulf SMEs**, with three promises:

1. **Stock cannot leave without a manager's approval, and the system itself enforces it.** Not just a screen that hides a button. Even a technical shortcut cannot move the stock.
2. **Every change is recorded and cannot be altered**, so there is always an answer to "who did this, when, and from which channel".
3. **Managers and warehouse staff can approve and receive tasks by WhatsApp, and later by voice, including Egyptian Arabic.** This is the opening nobody else has filled.

Plus, as the business position:

- **Clear prices in Egyptian pounds.** Every warehouse feature is included. No hidden add-ons.
- **Arabic first, and usable on a phone.**
- **Quick to start.** A small warehouse should be set up in an afternoon without a consultant.

## 4. What we will build first

A deliberately small first version that tests the idea:

> Add an item → a staff member requests stock to go out → the manager approves → the stock is issued → the action appears in the audit log.

The approval step is built so that WhatsApp and voice plug in later without redoing anything. We do not build WhatsApp or voice until we know customers want them.

We are **not** building: CRM, HR, payroll, time tracking or full accounting. This is a stock product.

## 5. Steps and checkpoints

| Step | What happens | How we know it worked |
|---|---|---|
| **0. Prove the demand** | Try the six competitors hands-on (a checklist is ready). Interview 8-10 Egyptian businesses that hold stock. | Customers say they would use WhatsApp or voice approvals, and say what they would pay. If they do not, we stop or change direction before spending on the build. |
| **1. First version** | Item, request, approval, issue, audit log, in Arabic and English. | A manager completes the whole flow on a phone. We prove that stock cannot be moved without approval. |
| **2. Pilot with a real customer** | WhatsApp approvals (if step 0 says yes), easy data import, receipts and transfers, batches and expiry dates. | A pilot customer is set up in one afternoon and uses it daily. |
| **3. Differentiate and charge** | Tasks over WhatsApp, voice in Egyptian Arabic, billing in Egyptian pounds. | Voice reaches an agreed accuracy on Egyptian Arabic phrases. The public price list matches what is charged. |

We are reusing the generic foundation of our existing internal ERP (sign-in, multi-company support, permissions). We are rewriting the parts that record changes, because the current approach could let a stock change exist without a record. This is a fix to make before we rely on the "audit log" promise.

## 6. Risks, honestly

| Risk | How we deal with it |
|---|---|
| **Nobody has told us they want this.** | Step 0 comes first. We commit build budget only after interviews. |
| **Competitors can copy it.** Odoo and Microsoft are adding AI agents. Voice companies could move into ERP. | Move fast with the small first version, and use our voice and messaging experience at Bellvox. |
| **We cannot win on price alone.** | We compete on clarity and the WhatsApp/voice workflow instead. |
| **Some facts are unconfirmed** (for example, whether Edara's approval really holds stock). | The hands-on trials in step 0 settle this. |
| **WhatsApp is controlled by Meta** (approved message templates, rules, number approval). | Every approval can also be done in the app, so WhatsApp is never the only route. |
| **Egyptian e-invoicing is expected by many buyers.** | See decision 2 below. |

## 7. What we need you to decide

| # | Decision | Our recommendation |
|---|---|---|
| 1 | **Approve step 0** (trials and 8-10 interviews) and the time and contacts to do it. | Yes, now. This is the cheapest way to avoid a wrong turn. |
| 2 | **E-invoicing for Egypt (and later Saudi):** do we need it for the first customers? Options: build it ourselves, use a licensed provider, let customers keep their current tool, or leave it for later. | Leave it out of the pilot. Use a licensed provider when a customer needs it. The first version is built so adding it later is cheap. |
| 3 | **Who pays and how:** which company bills customers, and which payment service to use (Paymob is our working guess; others are on the shortlist). | Invoice and bank transfer for the first few customers. Add a payment service once there are paying customers. We need quotes before deciding. |
| 4 | **WhatsApp supplier:** use Meta directly or a local provider. | Get quotes from both, decide after step 0. |
| 5 | **Product name and branding.** | Needed before the first customer-facing materials. |
| 6 | **Where customer data is stored,** and whether Saudi customers will need it kept in Saudi Arabia. | Start in one region and revisit when a Saudi customer asks. |
| 7 | **Support:** who answers customers during the pilot, and during what hours. Edara is criticised for limited support hours. | Name an owner and hours before the pilot starts. |

## 8. What this plan does not cover

- **Cost and timeline.** We have deliberately not given numbers; they come in a separate costing once step 0 is done.
- **Build versus customise.** Whether it is cheaper to customise Odoo or ERPNext is a fair question. Odoo lacks the built-in approval and ERPNext costs a lot to implement, but we have not compared the cost properly yet.
- **Bellvox's readiness** to host the voice and messaging parts.

## 9. What happens next

If you approve decision 1, we start the trials and interviews immediately and come back with a firm recommendation, including the cost and timeline, before any build budget is requested.

*Supporting documents: the market gap research, the meeting Q&A and the technical plan (`TECHNICAL_PLAN.md`) for the engineering team.*
