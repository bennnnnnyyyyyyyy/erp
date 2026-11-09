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
