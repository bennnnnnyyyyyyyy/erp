# Arabic review sheet: machine drafts added on 2026-11-09

These Arabic texts were written by Claude (machine drafts), not yet checked by a native speaker. 34 strings: UX decisions
batch 3 (editing records, sole-owner approval, partial receipts) and the simulated Central Bank of Egypt rates.
Write the correct Arabic in the last column (leave it empty if it is right); Claude applies the corrections and marks the row reviewed.
Placeholders such as `{name}`, `{item}` and `{n}` must stay exactly as they are (a test checks this).

| # | Where | English | Arabic now (machine draft) | Correction |
|---|---|---|---|---|
| 1 | Screens | Edit {name} | تعديل {name} | |
| 2 | Screens | The SKU and unit stay the same, because documents and quantities depend on them. Every change is kept in the history. | يبقى رمز الصنف والوحدة كما هما، لأن المستندات والكميات تعتمد عليهما. يُحفظ كل تغيير في السجل. | |
| 3 | Screens | The code stays the same, because it is printed on documents. Every change is kept in the history. | يبقى الكود كما هو، لأنه مطبوع على المستندات. يُحفظ كل تغيير في السجل. | |
| 4 | Screens | customer updated | تم تعديل العميل | |
| 5 | Screens | supplier updated | تم تعديل المورد | |
| 6 | Screens | item updated | تم تعديل الصنف | |
| 7 | Screens | You made this request. If you are the only owner or manager, you can approve it yourself and the history marks it as self-approved. Otherwise another owner or manager must approve it. | أنت من قدّم هذا الطلب. إن كنت المالك أو المدير الوحيد، يمكنك اعتماده بنفسك ويُسجَّل في السجل أنه اعتماد ذاتي. وإلا فيجب أن يعتمده مالك أو مدير آخر. | |
| 8 | Screens | request self approved | تم اعتماد الطلب ذاتيًا | |
| 9 | Screens | Partly received | مستلم جزئيًا | |
| 10 | Screens | order partly received | تم استلام الأمر جزئيًا | |
| 11 | Screens | What arrived? | ما الذي وصل؟ | |
| 12 | Screens | Still to come | المتبقي | |
| 13 | Screens | Arrived now | وصل الآن | |
| 14 | Screens | Arrived now: {item} | وصل الآن: {item} | |
| 15 | Screens | Is the rest still coming? | هل سيصل الباقي؟ | |
| 16 | Screens | Yes, keep the order open for the rest | نعم، أبقِ الأمر مفتوحًا للباقي | |
| 17 | Screens | No, close the order: the rest will not come | لا، أغلق الأمر: الباقي لن يصل | |
| 18 | Screens | Close the order | إغلاق الأمر | |
| 19 | Screens | Receive into stock | استلام في المخزون | |
| 20 | Screens | Receive every line of this order in full? | استلام كل أسطر هذا الأمر بالكامل؟ | |
| 21 | Screens | Check the quantity for {item}: from 0 up to {n}. | راجع الكمية لـ {item}: من 0 حتى {n}. | |
| 22 | Screens | Say whether the rest is still coming. | حدّد إن كان الباقي سيصل. | |
| 23 | Screens | Received what arrived. The order stays open for the rest. | تم استلام ما وصل. يبقى الأمر مفتوحًا للباقي. | |
| 24 | Screens | Received what arrived. The order is closed; the rest will not come. | تم استلام ما وصل. أُغلق الأمر؛ الباقي لن يصل. | |
| 25 | Screens | Central Bank of Egypt | البنك المركزي المصري | |
| 26 | Screens | SIMULATED | تجريبي | |
| 27 | Screens | Practice numbers only: worked out from the daily rate above, not the Central Bank’s own figures. They are not saved and nothing is converted with them. Live rates come later. | أرقام للتجربة فقط: محسوبة من السعر اليومي أعلاه، وليست أرقام البنك المركزي نفسه. لا تُحفظ ولا يُحوَّل بها أي مبلغ. الأسعار الفعلية لاحقًا. | |
| 28 | Screens | Buy (EGP) | شراء (ج.م) | |
| 29 | Screens | Sell (EGP) | بيع (ج.م) | |
| 30 | Error messages | You cannot approve your own request: another owner or manager must approve it | لا يمكنك اعتماد طلبك بنفسك: يجب أن يعتمده مالك أو مدير آخر | |
| 31 | Error messages | Supplier name is required | اسم المورد مطلوب | |
| 32 | Error messages | Customer name is required | اسم العميل مطلوب | |
| 33 | Error messages | Item name is required | اسم الصنف مطلوب | |
| 34 | Error messages | Each line needs a quantity of 0 or more, and say whether the rest is still coming | يحتاج كل سطر إلى كمية صفر أو أكثر، وحدّد إن كان الباقي سيصل | |

## Added 10 November: setup wizard, "What do you sell?" (machine drafts, in `apps/web/src/modules/help/onboardingContent.ts`)

| # | Where | English | Arabic now (machine draft) | Correction |
|---|---|---|---|---|
| 35 | Wizard | What do you sell? | ماذا تبيع؟ | |
| 36 | Wizard | Choose the closest. Setup then shows only the steps that fit your business; you can change your mind on this step at any time. | اختر الأقرب. بعدها يعرض الإعداد الخطوات التي تناسب نشاطك فقط، ويمكنك تغيير اختيارك في هذه الخطوة في أي وقت. | |
| 37 | Wizard | Tell us what you sell | أخبرنا بما تبيعه | |
| 38 | Wizard | A shop or general trading / Clothes, electronics, home goods, spare parts… | محل أو تجارة عامة / ملابس، إلكترونيات، أدوات منزلية، قطع غيار… | |
| 39 | Wizard | Food or drinks / Groceries, dairy, frozen food, drinks… | أغذية أو مشروبات / بقالة، ألبان، مجمدات، مشروبات… | |
| 40 | Wizard | Medicine / A pharmacy or medicine distribution | أدوية / صيدلية أو توزيع أدوية | |
| 41 | Wizard | Cosmetics / Creams, perfumes, personal care… | مستحضرات تجميل / كريمات، عطور، عناية شخصية… | |
| 42 | Wizard | Building materials / Cement, steel, tiles, paint… | مواد بناء / أسمنت، حديد، سيراميك، دهانات… | |
| 43 | Wizard | Something else / Any other goods | شيء آخر / أي بضائع أخرى | |
| 44 | Wizard | Units are usually ton, bag, m² or m³. | الوحدات عادةً: طن أو شيكارة أو م² أو م³. | |
| 45 | Wizard | (the other five unit hints, same pattern) | see `onboardingContent.ts`, `business.unitHint` | |
| 46 | Menu | Stock counts / Stock count | جرد المخزون / جرد مخزون | |
| 47 | Stock counts | (the 28 texts of the Stock counts screens) | see `apps/web/src/lib/i18nDecisions.ts`, section "Stock counts screens" | |
| 48 | Item page | (the 25 texts of the item page: tabs, totals, empty states) | see `apps/web/src/lib/i18nDecisions.ts`, section "Item page" | |
| 49 | Menu | Item | صنف | |
| 50 | Inventory overview | (the 17 texts of the overview: numbers, "Needs you today" lines) | see `apps/web/src/lib/i18nDecisions.ts`, section "Inventory overview" | |
| 51 | Menu | Overview / Counting / Planning / Records and rules | نظرة عامة / الجرد / التخطيط / السجلات والقواعد | |
| 52 | Settings, stock counts | (the 9 texts of blind counts, the phone action bar and "No stock yet") | see `apps/web/src/lib/i18nDecisions.ts`, section "Blind counts" | |
| 53 | Bank statements | (about 70 texts of the bank statement screens and file messages; accounting terms to check: تسوية بنكية, كشف حساب, مطابقة) | see `apps/web/src/lib/i18nDecisions.ts`, section "Bank statements" | |
| 54 | Menu | Bank statements / Bank statement | كشوف الحساب البنكية / كشف حساب بنكي | |
| 55 | Bank statements | (the 36 texts of part 2: recording what a line was, rules, who may reconcile; terms to check: بند المصروف, مصروفات وعمولات بنكية, تسوية) | see `apps/web/src/lib/i18nDecisions.ts`, section "bank statements part 2" | |
| 56 | Errors | This feature is not set up yet: its database update has not been applied | هذه الميزة غير مُفعّلة بعد: لم يُطبَّق تحديث قاعدة البيانات الخاص بها | |
