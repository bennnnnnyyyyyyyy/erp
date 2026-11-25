// Arabic for the new-UI report screens (report library and sales forecast in versions, 24 Nov 2026). Machine draft: native review
// needed (documentation/reviews/arabic-review-sheet.md). The Reports module's own texts are in i18nReports.ts. English text is the key.
export const REPORTS_UI_AR: Record<string, string> = {
  // report library
  Screen: 'شاشة',
  '{n} reports': '{n} تقارير',
  'Ready-made: opens in the report builder, where you can change it and save your own copy.': 'جاهز: يفتح في منشئ التقارير، حيث يمكنك تعديله وحفظ نسختك الخاصة.',
  Areas: 'المجالات',
  'All reports': 'كل التقارير',
  'What it answers': 'ما الذي يجيب عنه',
  Area: 'المجال',
  'Open and run': 'فتح وتشغيل',
  'Opens in the report builder, where you can change it and save your own copy.': 'يفتح في منشئ التقارير، حيث يمكنك تعديله وحفظ نسختك الخاصة.',
  'Choose a report to see what it shows. Double-click or press Enter to open it.': 'اختر تقريرًا لترى ما يعرضه. انقر نقرًا مزدوجًا أو اضغط Enter لفتحه.',
  // sales forecast
  ' and {n} more': ' و{n} غيرها',
  'In the next {n} days you are likely to sell about {next}. In the last 30 days you sold {last}.':
    'في الأيام الـ {n} القادمة يُتوقع أن تبيع نحو {next}. في آخر 30 يومًا بعت {last}.',
  'Going up: {names}.': 'في ارتفاع: {names}.',
  'Going down: {names}.': 'في انخفاض: {names}.',
  '{n} of them have little history, so their number is a guess.': '{n} منها تاريخها قصير، فرقمها تقديري.',
  'Forecast, per 30 days of the next {n}': 'التوقع، لكل 30 يومًا من الأيام الـ {n} القادمة',
  'a guess': 'تقديري',
  'Show the table': 'إظهار الجدول',
  'Going up': 'في ارتفاع',
  'Going down': 'في انخفاض',
  // dead ends (25 Nov): say why a list is empty and offer the step that fills it
  'A report shows when you can open the page its data comes from. An owner or admin gives access in Settings → Users.':
    'يظهر التقرير عندما يمكنك فتح الصفحة التي تأتي منها بياناته. يمنح المالك أو المدير الصلاحية من الإعدادات ← المستخدمون.',
  'Clear the search': 'مسح البحث',
  'You have no saved reports yet. Open a report, change it, and press Save: it shows here under "My reports".':
    'ليس لديك تقارير محفوظة بعد. افتح تقريرًا وعدّله ثم اضغط حفظ: سيظهر هنا تحت "تقاريري".',
  'Open sales invoices': 'فتح فواتير المبيعات',
  // report builder (three versions, 25 Nov)
  'A report only shows data from the pages you can open. An owner or admin gives access in Settings → Users.':
    'لا يعرض التقرير إلا بيانات الصفحات التي يمكنك فتحها. يمنح المالك أو المدير الصلاحية من الإعدادات ← المستخدمون.',
  'Open the report library': 'فتح مكتبة التقارير',
  'It uses data from a page you cannot open. Choose another report, or start a new one.': 'يستخدم بيانات من صفحة لا يمكنك فتحها. اختر تقريرًا آخر، أو ابدأ تقريرًا جديدًا.',
  'Choose what to split by in the sentence first.': 'اختر أولًا ما تقسّم حسبه في الجملة.',
  'You already have a report with this name. Choose another name.': 'لديك تقرير بهذا الاسم بالفعل. اختر اسمًا آخر.',
  'Only owners and admins save reports for the whole company.': 'المالكون والمديرون فقط يحفظون تقارير للشركة كلها.',
  'Your "Only include" choices leave nothing.': 'اختيارات "اعرض فقط" لم تُبقِ شيئًا.',
  'Remove them': 'إزالتها',
  'Nothing was recorded in this period.': 'لم يُسجَّل شيء في هذه الفترة.',
  'Look at the last 12 months': 'اعرض آخر 12 شهرًا',
  'Nothing has been recorded for this data yet. It fills as the company works.': 'لم يُسجَّل شيء لهذه البيانات بعد. تمتلئ مع عمل الشركة.',
  Refine: 'تحسين النتيجة',
  'Only include': 'اعرض فقط',
  'Every line is included.': 'كل السطور معروضة.',
  'Also show': 'اعرض أيضًا',
  'Split again': 'قسّم أيضًا',
  'Order and rows': 'الترتيب وعدد الصفوف',
  'To be alerted, save this report for the company first.': 'لتصلك التنبيهات، احفظ هذا التقرير للشركة أولًا.',
  'Alerts work on company reports: save a copy for the company.': 'التنبيهات تعمل على تقارير الشركة: احفظ نسخة للشركة.',
  'Alerts watch a total: choose a number to show, not a list.': 'التنبيه يراقب إجماليًا: اختر رقمًا للعرض، لا قائمة.',
};
