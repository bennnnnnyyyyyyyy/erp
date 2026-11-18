# VAT: questions for the accountant (17 Nov 2026)

What the app does today is built and live (see [VAT_PLAN.md](../plans/VAT_PLAN.md)). Every answer below becomes a setting, a name or
a small adjustment, not a rebuild. Arabic follows each group. Numbers in brackets point to the plan's sections.

## A. Rates and what each product gets (2.1)

1. For each product or service the company sells: 14%, 5% (machinery for production use), exempt under Article 23 (which item number of
   the annex), or a schedule (Table) good?
2. Does the company sell to exporters, free-zone or economic-zone companies, embassies, or buyers who use machines for production? For
   each such customer, is the VAT treatment the same on every invoice (we would store it on the customer) or does it vary (chosen per line)?
3. For 5% and exempt sales, what proof does the ETA expect on the e-invoice (buyer certificate, registration, ETA sub-type)?
4. Did the July 2025 and July 2026 amendments change anything the company sells?

> ١. لكل منتج أو خدمة تبيعها الشركة: هل هو ١٤٪، أم ٥٪ (آلات لاستخدام إنتاجي)، أم معفى وفق المادة ٢٣ (ما رقم البند في الملحق)، أم سلعة جدول؟
> ٢. هل تبيع لمصدّرين أو شركات منطقة حرة أو منطقة اقتصادية أو سفارات أو مشترين يستخدمون الآلات في الإنتاج؟ لكل عميل منهم: هل المعاملة الضريبية واحدة في كل فواتيره (فنحفظها على العميل) أم تختلف (فتُختار لكل بند)؟
> ٣. للمبيعات بنسبة ٥٪ والمعفاة: ما المستند الذي تطلبه مصلحة الضرائب على الفاتورة الإلكترونية (شهادة المشتري، التسجيل، الكود الفرعي)؟
> ٤. هل غيّرت تعديلات يوليو ٢٠٢٥ ويوليو ٢٠٢٦ شيئًا مما تبيعه الشركة؟

## B. Accounts, the return and its deadline (11, 15)

5. Accounts: we use 2871 output VAT, 1811 input VAT and 2872 VAT settlement. Keep these codes, or do you use others? (In the unified
   chart reference we have, group 18 is "current financial investments"; 1811 shows on the balance sheet as another current asset.)
6. The return: which sections of the VAT return (Form 10) should the summary follow, and how are capital assets and imports shown on it?
7. The deadline: end of the following month, or another rule? (The app keeps it as a setting.)
8. Refunds: a credit carried for more than 4 consecutive periods (more than 3 months for a small enterprise under Law 6/2025)? What
   proof is needed to ask for it?
9. Should the month be closed from the books (our choice) or from the documents? Is one journal per month (output and input VAT cleared
   to the settlement account) what you expect?

> ٥. الحسابات: نستخدم ٢٨٧١ ضريبة المخرجات و١٨١١ ضريبة المدخلات و٢٨٧٢ تسوية الضريبة. هل نبقي هذه الأكواد أم تستخدم غيرها؟ (في مرجع الدليل الموحد لدينا المجموعة ١٨ هي «استثمارات مالية متداولة»، و١٨١١ يظهر في الميزانية كأصل متداول آخر.)
> ٦. الإقرار: ما بنود إقرار ضريبة القيمة المضافة (نموذج ١٠) التي يجب أن يتبعها الملخص، وكيف تظهر فيه الأصول الرأسمالية والواردات؟
> ٧. الموعد: نهاية الشهر التالي أم قاعدة أخرى؟ (التطبيق يحفظه كإعداد.)
> ٨. الاسترداد: رصيد دائن لأكثر من ٤ فترات متتالية (أكثر من ٣ أشهر للمنشأة الصغيرة وفق قانون ٦ لسنة ٢٠٢٥)؟ وما المستندات المطلوبة لطلبه؟
> ٩. هل يُقفل الشهر من الدفاتر (اختيارنا) أم من المستندات؟ وهل قيد واحد شهريًا (تصفية ضريبة المخرجات والمدخلات إلى حساب التسوية) هو ما تتوقعه؟

## C. Corrections and timing (11, 14, 16)

10. A credit note (or a void) for an invoice in a month already filed: corrected in the next month's return, or by amending the old one?
11. Does VAT arise on a customer advance paid before the invoice?
12. Supplier credit notes: are the return of goods and the supplier's note always one document? Do they reduce input VAT in the month
    of the note's date or the month we approve it?
13. Partial deduction: when a company has both taxable and exempt sales, how is input VAT shared (by turnover ratio, by direct
    allocation)? Over which period?
14. Prices that include VAT: we split each line as net = round(total × 100 ÷ (100 + rate)), VAT = the rest. Is that how the ETA expects
    inclusive prices to be rounded?
15. Bills: we accept the VAT printed on the supplier's invoice when it is within the larger of 1 piaster per line and 5 piasters per
    bill of the VAT worked out from the lines. Is that tolerance acceptable?
16. Non-deductible VAT: on goods we add it to the stock cost; on capital purchases recorded as expenses we expense it until the app has
    a fixed-asset register. Is that acceptable for now?

> ١٠. إشعار دائن (أو إلغاء) لفاتورة في شهر قُدّم إقراره: يُصحَّح في إقرار الشهر التالي أم بتعديل الإقرار القديم؟
> ١١. هل تستحق الضريبة على دفعة مقدمة من العميل قبل الفاتورة؟
> ١٢. إشعارات الدائن من الموردين: هل رد البضاعة وإشعار المورد مستند واحد دائمًا؟ وهل تُخفَّض ضريبة المدخلات في شهر تاريخ الإشعار أم شهر اعتمادنا له؟
> ١٣. الخصم الجزئي: عندما تكون للشركة مبيعات خاضعة ومعفاة، كيف تُوزَّع ضريبة المدخلات (بنسبة المبيعات أم بالتخصيص المباشر)؟ وعلى أي فترة؟
> ١٤. الأسعار الشاملة للضريبة: نقسم كل بند كالتالي: الصافي = تقريب(الإجمالي × ١٠٠ ÷ (١٠٠ + النسبة))، والضريبة = الباقي. هل هذا ما تتوقعه مصلحة الضرائب في التقريب؟
> ١٥. فواتير الموردين: نقبل الضريبة المطبوعة على فاتورة المورد إذا كانت في حدود الأكبر من قرش لكل بند و٥ قروش للفاتورة عن الضريبة المحسوبة من البنود. هل هذا الهامش مقبول؟
> ١٦. الضريبة غير القابلة للخصم: على البضاعة نضيفها لتكلفة المخزون، وعلى المشتريات الرأسمالية المسجلة كمصروفات نحمّلها كمصروف إلى أن يكون في التطبيق سجل للأصول الثابتة. هل هذا مقبول حاليًا؟
