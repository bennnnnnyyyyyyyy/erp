// Arabic for People and the HR & payroll app card (sql/102; documentation/plans/HR_APP_INTEGRATION_PLAN.md).
// MACHINE DRAFT for Ben's review, like the other i18n files.

export const PEOPLE_AR: Record<string, string> = {
  'Your staff as your HR and payroll app lists them. Changes are made in the HR app and appear here within 15 minutes.':
    'موظفوك كما يعرضهم تطبيق الموارد البشرية والرواتب. التعديلات تُجرى في تطبيق الموارد البشرية وتظهر هنا خلال 15 دقيقة.',
  'Last read from the HR app: {when}': 'آخر قراءة من تطبيق الموارد البشرية: {when}',
  'Not read from the HR app yet. Switch the HR app on in Settings → Integrations.':
    'لم تتم القراءة من تطبيق الموارد البشرية بعد. فعّل تطبيق الموارد البشرية من الإعدادات ← التكاملات.',
  'It failed': 'فشلت',
  'Partly read; the rest comes with the next read.': 'قُرئ جزء منها؛ الباقي يأتي مع القراءة التالية.',
  'Sync now': 'مزامنة الآن',
  'Asked. The HR app is read within 5 minutes.': 'تم الطلب. ستتم القراءة من تطبيق الموارد البشرية خلال 5 دقائق.',
  Search: 'بحث',
  'Name, number or job title': 'الاسم أو الرقم أو المسمى الوظيفي',
  'On leave': 'في إجازة',
  Left: 'ترك العمل',
  'No people yet. They appear after the first read from the HR app.': 'لا يوجد موظفون بعد. يظهرون بعد أول قراءة من تطبيق الموارد البشرية.',
  'Nobody matches.': 'لا يوجد من يطابق البحث.',
  'Job title': 'المسمى الوظيفي',
  Department: 'القسم',
  Manager: 'المدير المباشر',
  'Work email': 'بريد العمل',
  'Uses the ERP as': 'يستخدم النظام باسم',
  '{count} people': '{count} موظفين',
  Previous: 'السابق',
  Next: 'التالي',
  '{name} linked.': 'تم ربط {name}.',
  '{name} unlinked.': 'تم إلغاء ربط {name}.',
  'switched off in the ERP': 'موقوف في النظام',
  'left in the HR app but can still sign in': 'ترك العمل في تطبيق الموارد البشرية لكنه ما زال يستطيع الدخول',
  'Not linked': 'غير مرتبط',
  'Suggested: {name}': 'مقترح: {name}',
  'ERP member': 'مستخدم النظام',
  'HR branches and ERP branches': 'فروع الموارد البشرية وفروع النظام',
  'Match each branch in the HR app to a branch here. A branch with the same code is matched for you.':
    'طابِق كل فرع في تطبيق الموارد البشرية مع فرع هنا. الفرع الذي يحمل الكود نفسه يُطابَق تلقائيًا.',
  'HR app branch': 'فرع تطبيق الموارد البشرية',
  'ERP branch': 'فرع النظام',
  'Not matched': 'غير مطابَق',
  // Settings > Integrations: the HR app card (packages/shared/src/integrations.ts)
  'HR and payroll': 'الموارد البشرية والرواتب',
  'HR & payroll app': 'تطبيق الموارد البشرية والرواتب',
  'Branches, departments and employees from your HR and payroll app, read every 15 minutes, shown in People.':
    'الفروع والأقسام والموظفون من تطبيق الموارد البشرية والرواتب، تُقرأ كل 15 دقيقة وتظهر في الموظفين.',
  'HR app address': 'عنوان تطبيق الموارد البشرية',
  'The address shown on the ERP card in your HR app.': 'العنوان الظاهر في بطاقة النظام داخل تطبيق الموارد البشرية.',
  'ERP key': 'مفتاح النظام',
  'In the HR app: Settings → Integrations → ERP → Create ERP key. It is shown once there.':
    'في تطبيق الموارد البشرية: الإعدادات ← التكاملات ← النظام ← إنشاء مفتاح النظام. يظهر هناك مرة واحدة فقط.',
};
