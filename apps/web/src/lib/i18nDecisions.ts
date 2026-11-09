// Arabic for the wording added by the 9 Nov 2026 decisions (documentation/planning/2026-11-09-ux-decisions.md). Machine drafts for Ben's review.

export const DECISIONS_AR: Record<string, string> = {
  // D5 quick-add
  '+ New': '+ جديد',
  'New customer': 'عميل جديد',
  'New supplier': 'مورد جديد',
  'Add and use': 'أضف واستخدم',
  // type-to-search lists
  'Type to search…': 'اكتب للبحث…',
  'Nothing matches.': 'لا توجد نتائج مطابقة.',
  'Type to see more.': 'اكتب لرؤية المزيد.',
  // D10 My settings
  'Only for you. Company settings are kept by the owner and managers.': 'لك وحدك. إعدادات الشركة يديرها المالك والمديرون.',
  'My account': 'حسابي',
  '{role} at {company}': '{role} في {company}',
  'New password': 'كلمة المرور الجديدة',
  'New password again': 'كلمة المرور الجديدة مرة أخرى',
  'Change password': 'تغيير كلمة المرور',
  'Use at least 8 characters.': 'استخدم 8 أحرف على الأقل.',
  'The two passwords are not the same.': 'كلمتا المرور غير متطابقتين.',
  'Password changed. Use it the next time you sign in.': 'تم تغيير كلمة المرور. استخدمها في المرة القادمة التي تسجّل فيها الدخول.',
  'My notifications': 'إشعاراتي',
  'Approvals, tasks and alerts for you appear in the bell at the top of every page.': 'تظهر الموافقات والمهام والتنبيهات الخاصة بك في الجرس أعلى كل صفحة.',
  'Link your phone below to also get them on Telegram.': 'اربط هاتفك أدناه لتصلك أيضًا على Telegram.',
  'Choosing which messages you get is coming later.': 'اختيار الرسائل التي تصلك سيتاح لاحقًا.',
  'Connect my phone': 'ربط هاتفي',
  'Link your Telegram so messages reach you on your phone. Decisions are still made in the app.': 'اربط Telegram لتصلك الرسائل على هاتفك. تظل القرارات داخل التطبيق.',
  // D7 paid now
  'Paid now': 'دُفع الآن',
  'Record expense and payment': 'سجّل المصروف والدفع',
  'Expense {number} recorded and paid.': 'سُجّل المصروف {number} ودُفع.',
  'Expense {number} recorded, but the payment was not: {reason}. Pay it from Payments.': 'سُجّل المصروف {number}، لكن لم يُسجَّل الدفع: {reason}. ادفعه من صفحة المدفوعات.',
  // D8 stock value page
  '{n} more items are not shown; all of them are corrected together.': 'لا يظهر {n} صنفًا آخر؛ وتُصحَّح كلها معًا.',
  'Effect on profit this month: {diff}.': 'الأثر على ربح هذا الشهر: {diff}.',
  "The difference is booked as a stock adjustment, which changes this month's profit by the same amount.": 'يُسجَّل الفرق كتسوية مخزون، فيتغير ربح هذا الشهر بالمبلغ نفسه.',
  'Post one entry of {diff} to bring stock to average cost? Profit this month changes by the same amount. It cannot be edited afterwards, only reversed by another entry.':
    'ترحيل قيد واحد بقيمة {diff} لجعل المخزون بمتوسط التكلفة؟ يتغير ربح هذا الشهر بالمبلغ نفسه. لا يمكن تعديله بعد ذلك، فقط عكسه بقيد آخر.',
  // D2 wording
  'Only for you, on every device you sign in on.': 'لك وحدك، على كل جهاز تسجّل الدخول منه.',
  // Batch 3: D4 editing records (sql/062)
  'Edit {name}': 'تعديل {name}',
  'The SKU and unit stay the same, because documents and quantities depend on them. Every change is kept in the history.':
    'يبقى رمز الصنف والوحدة كما هما، لأن المستندات والكميات تعتمد عليهما. يُحفظ كل تغيير في السجل.',
  'The code stays the same, because it is printed on documents. Every change is kept in the history.':
    'يبقى الكود كما هو، لأنه مطبوع على المستندات. يُحفظ كل تغيير في السجل.',
  'customer updated': 'تم تعديل العميل',
  'supplier updated': 'تم تعديل المورد',
  'item updated': 'تم تعديل الصنف',
  // D1 sole approver (sql/063)
  'You made this request. If you are the only owner or manager, you can approve it yourself and the history marks it as self-approved. Otherwise another owner or manager must approve it.':
    'أنت من قدّم هذا الطلب. إن كنت المالك أو المدير الوحيد، يمكنك اعتماده بنفسك ويُسجَّل في السجل أنه اعتماد ذاتي. وإلا فيجب أن يعتمده مالك أو مدير آخر.',
  'request self approved': 'تم اعتماد الطلب ذاتيًا',
  // D3 partial receipts (sql/064)
  'Partly received': 'مستلم جزئيًا',
  'order partly received': 'تم استلام الأمر جزئيًا',
  'What arrived?': 'ما الذي وصل؟',
  'Still to come': 'المتبقي',
  'Arrived now': 'وصل الآن',
  'Arrived now: {item}': 'وصل الآن: {item}',
  'Is the rest still coming?': 'هل سيصل الباقي؟',
  'Yes, keep the order open for the rest': 'نعم، أبقِ الأمر مفتوحًا للباقي',
  'No, close the order: the rest will not come': 'لا، أغلق الأمر: الباقي لن يصل',
  'Close the order': 'إغلاق الأمر',
  'Receive into stock': 'استلام في المخزون',
  'Receive every line of this order in full?': 'استلام كل أسطر هذا الأمر بالكامل؟',
  'Check the quantity for {item}: from 0 up to {n}.': 'راجع الكمية لـ {item}: من 0 حتى {n}.',
  'Say whether the rest is still coming.': 'حدّد إن كان الباقي سيصل.',
  'Received what arrived. The order stays open for the rest.': 'تم استلام ما وصل. يبقى الأمر مفتوحًا للباقي.',
  'Received what arrived. The order is closed; the rest will not come.': 'تم استلام ما وصل. أُغلق الأمر؛ الباقي لن يصل.',
  // Central Bank of Egypt rates, simulated (9 Nov). MACHINE DRAFT: listed in documentation/plans/2026-11-09-arabic-review-sheet.md.
  'Central Bank of Egypt': 'البنك المركزي المصري',
  SIMULATED: 'تجريبي',
  'Practice numbers only: worked out from the daily rate above, not the Central Bank’s own figures. They are not saved and nothing is converted with them. Live rates come later.':
    'أرقام للتجربة فقط: محسوبة من السعر اليومي أعلاه، وليست أرقام البنك المركزي نفسه. لا تُحفظ ولا يُحوَّل بها أي مبلغ. الأسعار الفعلية لاحقًا.',
  'Buy (EGP)': 'شراء (ج.م)',
  'Sell (EGP)': 'بيع (ج.م)',
};
