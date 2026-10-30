# Questions for Ben

Answer by writing next to each one, or just say "defaults". **I keep building on the default while you answer**, and change course if you pick something else. Nothing here blocks me for long.

Why these matter: [documentation/plans/OWNER_INSIGHTS_PLAN.md](documentation/plans/OWNER_INSIGHTS_PLAN.md)

## Decisions recorded from your answers (Claude, 2026-10-30)

| # | Decision | What I do about it |
|---|---|---|
| 1 | Average cost | Built (sql/023, test 019). |
| 2 | Manufacturing later | Not built; profit is approximate until it exists. Stays in the plan as slice M. |
| 3 | UI list | **Still missing.** No `ui-issues/` folder and no list. I will do a general polish pass with the owner home page and say what I changed; send the five worst when you can. |
| 4 | Language is **one setting for the whole organization**, chosen when the organization signs up | Replaces the per-browser switch. New org setting `language` (en / ar), set at sign-up, owner can change it in Settings; everyone in the org sees that language and direction. Planned in the next migration. |
| 5 | You are not sure about teams | I choose: teams are named groups of users (Purchasing, Warehouse, Management are created by default); a rule can also say "everyone with role X". Whoever buys stuff is added to Purchasing by the owner. |
| 6 | EGP, changeable; profit "whatever is best for business" | Currency stays an organization setting. **Profit is shown without VAT** (VAT is money owed to the tax authority, not profit), with a note on screen. VAT tracking itself is not built yet. |
| 7 | No more notes from the boss | I build from the short note; send more when you have them. |
| 8 | Deny rules **yes**, rotate passwords **no** | `.claude/settings.json` created. Demo passwords untouched. |
---

## 1. Cost of an item

How do we price stock that went out?

- [x] **Average cost** (default). Every receipt updates one average cost per item. Simple, easy to explain to an owner.
- [ ] **First in, first out by batch.** More exact for expiry stock, harder to explain.

Your answer:

---

## 2. Manufacturing

A cosmetics factory buys raw materials and makes products. Do we build **recipes and production orders** (raw materials go down, finished goods go up)?

- [ ] **Yes, build it right after the money and expiry parts.**
- [x] **Later** (default). Finished goods are just received into stock for now. Profit is approximate until this exists.
- [ ] **Not for the boss's demo at all.**

Your answer:

---

## 3. The UI problems

You said the UI has a lot of issues. I have **not seen the app in a browser**, so I won't guess.

Please list the **worst five**, or drop screenshots into a folder called `ui-issues/` in the repo root and tell me.

---

## 4. Owner home page

- Arabic first (right to left) for the owner's home page? **default: yes, with a switch to English**
- Who checks the Arabic wording? (A native speaker should. My Arabic is a draft.)

Your answer: language decition is app wide, when the org sign up

---

## 5. Teams

When a rule says "tell Purchasing", is **Purchasing just a named group of users** we create in settings?

- [x] Yes (default)
- [ ] No, something else: tell whoever is in charge of buying stuff im not a specialist in this

---

## 6. Money

- Currency **EGP only** for now? **default: yes** we can change it ofcout
- Profit shown **without VAT**? **default: yes**, with a note on screen, whats best fot business
- Egypt e-invoicing (tax authority) is a separate decision, not part of this. OK? **default: yes**

Your answer:

---

## 7. The boss's notes

Do you have anything more from the boss than the short note? A list, a sketch, screenshots of what the **first screen** should show. Even a photo of a page is fine.

Your answer:

---

## 8. Cleanup I need a yes for

- [x] Add deny rules to `.claude/settings.json` so the files in `.claudeignore` are really blocked (today `.claudeignore` is only a written convention).
- [ ] Rotate the three demo passwords (they are in `.temp\demo-credentials.txt`). dont

---

_Last updated by Claude: 2026-10-30. Delete answered questions or leave them, I read the whole file each time._
