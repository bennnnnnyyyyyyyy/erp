// The text of the Getting-started tutorial and the Guide, in English and Arabic. Bold is written as **bold** and rendered by
// components/Rich.tsx. Routes and logic stay in the components; only words live here, so a language is added by adding an object.
//
// The Arabic is a MACHINE DRAFT written for review: it must be checked by a native speaker (and the company's own terms agreed)
// before customers rely on it. The Arabic tutorial says so on screen (draftNote). Western digits are used on purpose, like the rest of the app.

import type { Lang } from '../../lib/i18n';

export type StepText = { title: string; toLabel: string; body: string };

export type TutorialContent = {
  title: string;
  intro: (orgName: string) => string;
  yourSetup: string;
  doneOf: (finished: number, total: number) => string;
  progressLabel: string;
  /** Same order as the checklist in GettingStarted.tsx: company, warehouse, item, colleague, supplier, customer, alert. */
  checklist: string[];
  srDone: string;
  srNotAvailable: string;
  srNotDone: string;
  /** Same order as the routes in GettingStarted.tsx (9 steps). */
  steps: StepText[];
  notReadyTitle: string;
  notReady: string[];
  hide: string;
  hideHintCan: string;
  hideHintCannot: string;
  /** Shown only where the text is a draft. */
  draftNote: string | null;
};

export type GuideContent = {
  title: string;
  intro: string;
  whereTitle: string;
  whereHint: string;
  fiveTitle: string;
  fiveHint: string;
  /** Same order as the routes in Guide.tsx (5 steps). */
  steps: StepText[];
  notReadyTitle: string;
  notReadyHint: string;
  notReady: string[];
  draftNote: string | null;
};

const TUTORIAL_EN: TutorialContent = {
  title: 'Getting started',
  intro: (org) => `A short guide to running ${org} in this system, in the order most companies set it up. Nothing here changes anything by itself: each step opens the real screen.`,
  yourSetup: 'Your setup',
  doneOf: (f, t) => `${f} of ${t} done`,
  progressLabel: 'Setup progress',
  checklist: ['Company created', 'Add your first warehouse', 'Add your first item', 'Invite a colleague', 'Add a supplier', 'Add a customer', 'Set up an alert'],
  srDone: 'done',
  srNotAvailable: 'not available to you',
  srNotDone: 'not done yet',
  steps: [
    { title: 'Make it yours', toLabel: 'Open Settings', body: 'Check the company name, currency and time zone, and the language everyone will see (Settings → General). The language, currency and time zone were set when you signed up. Roles: an **owner** or **admin** manages everything; **staff** raise requests, receive goods and do tasks; a **viewer** can only look.' },
    { title: 'Invite your team', toLabel: 'Open Users', body: 'Add colleagues by email (Settings → Users). Someone who already has an account gets an invitation they must accept; a new person gets a link to set a password. Put whoever buys stock in the **Purchasing** team later (step 8).' },
    { title: 'Add a warehouse and your items', toLabel: 'Open Inventory', body: 'A warehouse is any place you keep stock. On Inventory → Stock on hand press **Add warehouse**, then **Add item** (code, name, unit, and the opening quantity if you already have stock). Every movement afterwards is written to a ledger that cannot be edited: that is what makes the numbers trustworthy.' },
    { title: 'Move stock out safely', toLabel: 'Open Stock requests', body: 'Nothing leaves the warehouse without a request. Staff press **New request**; a manager (someone other than the requester) approves or rejects; then stock is issued. Stock is reserved the moment a request is raised, so two people cannot take the same units. For big quantities you can require more than one approver (Approval policies).' },
    { title: 'Buy and receive', toLabel: 'Open Purchasing', body: "Add suppliers, raise a **purchase order**, and press **Receive** when the goods arrive: the stock goes up and each item's average cost is updated. Record the supplier's invoice under **Purchase invoices**; it is matched against the quantity actually received." },
    { title: 'Sell and invoice', toLabel: 'Open Sales', body: 'Add customers, create a **sales order**, press **Request stock from warehouse** (it goes through the same approval as step 4), and once the goods are issued the order counts as delivered. Then raise the invoice under **Sales invoices**: an order can be invoiced in part, never beyond the delivered quantity, and a wrong invoice is voided, not edited.' },
    { title: 'Profit and loss', toLabel: 'Open Profit and loss', body: 'Record expenses and payments in **Finance** (owners and admins only). The home page then shows last month\'s net profit or loss, accounts receivable and payable, inventory value and batches nearing expiry. Cost of goods sold uses the weighted average cost of stock; VAT is not included.' },
    { title: 'Let the system watch for you', toLabel: 'Open Alerts', body: 'Alerts tell the right people when something needs attention: an item is low, will run out within N days (from your own sales history), a batch is about to expire, an invoice is late, or the month is losing money. Create teams (Purchasing, Warehouse, Management), then add rules and choose who is told. One digest message per person, not one per item.' },
    { title: 'Things that expire', toLabel: 'Open Batches and expiry', body: 'For anything with an expiry date: turn on **batch tracking** for that item. You receive it in batches with an expiry date, the system issues the batch that expires first, and an expired or quarantined batch is never issued. Name your storage places (for example a cold room, 2 to 8 °C): an item that needs the cold room cannot be received into an ambient store.' },
  ],
  notReadyTitle: 'What is not ready yet',
  notReady: [
    '**Approving by WhatsApp or voice** is not switched on yet. Messages can already be copied to email, Slack, Microsoft Teams or Telegram (Settings → Integrations); decisions are always made in the app.',
    '**Manufacturing** (recipes and production orders) is not built, so profit for a factory is approximate until it is.',
    '**Arabic** covers every screen.',
    "**Tax and e-invoicing** (VAT, the tax authority's electronic invoice) are not included. This is a management view, not statutory accounts.",
    'No printing or PDF of invoices yet.',
  ],
  hide: 'Hide this guide',
  hideHintCan: 'You can bring it back any time in Settings → General.',
  hideHintCannot: 'An owner or admin can hide this guide.',
  draftNote: null,
};

const TUTORIAL_AR: TutorialContent = {
  title: 'البدء',
  // U+2068 / U+2069 isolate the company name, which is usually Latin script, so it cannot reorder the Arabic sentence around it.
  intro: (org) => `دليل قصير لإدارة \u2068${org}\u2069 في هذا النظام، بالترتيب الذي تعتمده معظم الشركات عند الإعداد. لا يغيّر شيء هنا أي بيانات من تلقاء نفسه: كل خطوة تفتح الشاشة الحقيقية.`,
  yourSetup: 'إعدادك',
  doneOf: (f, t) => `${f} من ${t} مكتملة`,
  progressLabel: 'تقدّم الإعداد',
  checklist: ['تم إنشاء الشركة', 'أضف أول مخزن', 'أضف أول صنف', 'ادعُ زميلًا', 'أضف مورّدًا', 'أضف عميلًا', 'أنشئ تنبيهًا'],
  srDone: 'مكتمل',
  srNotAvailable: 'غير متاح لك',
  srNotDone: 'لم يكتمل بعد',
  steps: [
    { title: 'اجعله خاصًا بك', toLabel: 'فتح الإعدادات', body: 'راجع اسم الشركة والعملة والمنطقة الزمنية واللغة التي سيراها الجميع (الإعدادات ← عام). تم تحديد اللغة والعملة والمنطقة الزمنية عند التسجيل. الأدوار: **المالك** و**المدير** يديران كل شيء؛ **الموظفون** يرفعون الطلبات ويستلمون البضاعة وينفذون المهام؛ و**المشاهد** يستطيع الاطلاع فقط.' },
    { title: 'ادعُ فريقك', toLabel: 'فتح المستخدمين', body: 'أضف الزملاء بالبريد الإلكتروني (الإعدادات ← المستخدمون). من لديه حساب بالفعل تصله دعوة عليه قبولها، ومن ليس لديه حساب يصله رابط لتعيين كلمة المرور. ضع من يشتري المخزون في فريق **المشتريات** لاحقًا (الخطوة 8).' },
    { title: 'أضف مخزنًا وأصنافك', toLabel: 'فتح المخزون', body: 'المخزن هو أي مكان تحتفظ فيه بالبضاعة. في المخزون ← المخزون الحالي اضغط **إضافة مخزن** ثم **إضافة صنف** (الكود والاسم والوحدة والكمية الافتتاحية إن كان لديك مخزون). كل حركة بعد ذلك تُسجَّل في سجل لا يمكن تعديله، وهذا ما يجعل الأرقام موثوقة.' },
    { title: 'أخرج البضاعة بأمان', toLabel: 'فتح طلبات المخزون', body: 'لا تخرج أي بضاعة من المخزن دون طلب. يضغط الموظف **طلب جديد**؛ ويوافق أو يرفض مدير (شخص آخر غير مقدّم الطلب)؛ ثم تُصرف البضاعة. تُحجز الكمية بمجرد رفع الطلب، فلا يستطيع شخصان أخذ الوحدات نفسها. وللكميات الكبيرة يمكنك اشتراط أكثر من موافق (سياسات الموافقة).' },
    { title: 'اشترِ واستلم', toLabel: 'فتح المشتريات', body: 'أضف الموردين وأنشئ **أمر شراء** واضغط **استلام** عند وصول البضاعة: يرتفع المخزون ويتحدّث متوسط تكلفة كل صنف. سجّل فاتورة المورد ضمن **فواتير المشتريات**؛ تتم مطابقتها مع الكمية المستلمة فعلًا.' },
    { title: 'بِع وأصدر الفواتير', toLabel: 'فتح المبيعات', body: 'أضف العملاء وأنشئ **أمر بيع** واضغط **طلب مخزون من المستودع** (يمر بنفس الموافقة في الخطوة 4)، وبعد صرف البضاعة يُعدّ الأمر مسلَّمًا. ثم أصدر الفاتورة ضمن **فواتير المبيعات**: يمكن فوترة جزء من الأمر وليس أكثر من الكمية المسلَّمة، والفاتورة الخاطئة تُلغى ولا تُعدَّل.' },
    { title: 'الأرباح والخسائر', toLabel: 'فتح الأرباح والخسائر', body: 'سجّل المصروفات والمدفوعات في **المالية** (للمالكين والمديرين فقط). تعرض الصفحة الرئيسية بعدها صافي ربح أو خسارة الشهر الماضي، والذمم المدينة والدائنة، وقيمة المخزون، والتشغيلات القريبة من انتهاء الصلاحية. تُحسب تكلفة البضاعة المباعة بالمتوسط المرجّح لتكلفة المخزون؛ ولا تشمل ضريبة القيمة المضافة.' },
    { title: 'دع النظام يراقب عنك', toLabel: 'فتح التنبيهات', body: 'تُخبر التنبيهات الأشخاص المناسبين عندما يحتاج أمر إلى انتباه: نفاد صنف، أو قرب نفاده خلال عدد من الأيام (من سجل مبيعاتك)، أو قرب انتهاء صلاحية دفعة، أو تأخر فاتورة، أو خسارة الشهر. أنشئ فرقًا (المشتريات، المخزن، الإدارة)، ثم أضف قواعد واختر من يُبلَّغ. رسالة ملخص واحدة لكل شخص، لا رسالة لكل صنف.' },
    { title: 'ما تنتهي صلاحيته', toLabel: 'فتح الدفعات وتواريخ الانتهاء', body: 'لكل ما له تاريخ انتهاء: فعّل **تتبع الدفعات** لذلك الصنف. تستلمه على شكل دفعات بتاريخ انتهاء، ويصرف النظام الدفعة الأقرب انتهاءً أولًا، ولا تُصرف دفعة منتهية أو محجورة أبدًا. سمِّ أماكن التخزين (مثل غرفة التبريد، 2 إلى 8 درجات مئوية): الصنف الذي يحتاج غرفة التبريد لا يمكن استلامه في مخزن بدرجة حرارة الغرفة.' },
  ],
  notReadyTitle: 'ما ليس جاهزًا بعد',
  notReady: [
    '**الموافقة عبر واتساب أو الصوت** غير مفعّلة بعد. يمكن بالفعل نسخ الرسائل إلى البريد الإلكتروني أو Slack أو Microsoft Teams أو Telegram (الإعدادات ← التكاملات)؛ وتُتخذ القرارات دائمًا داخل التطبيق.',
    '**التصنيع** (الوصفات وأوامر الإنتاج) غير مبني، لذا تكون الأرباح لمصنع تقريبية إلى أن يُبنى.',
    '**العربية** تشمل كل الشاشات.',
    '**الضرائب والفاتورة الإلكترونية** (ضريبة القيمة المضافة والفاتورة الإلكترونية لمصلحة الضرائب) غير مشمولة. هذه نظرة إدارية وليست حسابات قانونية.',
    'لا طباعة ولا PDF للفواتير بعد.',
  ],
  hide: 'إخفاء هذا الدليل',
  hideHintCan: 'يمكنك إعادته في أي وقت من الإعدادات ← عام.',
  hideHintCannot: 'يمكن للمالك أو المدير إخفاء هذا الدليل.',
  draftNote: null,
};

const GUIDE_EN: GuideContent = {
  title: 'Guide',
  intro: 'How to find your way around, and a five-step path that shows what this system does. It is the same for everyone: you only see the apps you are allowed to use.',
  whereTitle: 'Where everything is',
  whereHint: 'Open any app from the home page, or from the links below. Inside an app, the menu on the left lists its pages.',
  fiveTitle: 'Five steps to see how it works',
  fiveHint: 'Use two people if you can: one asks for stock, a manager approves. The same person cannot do both.',
  steps: [
    { title: 'Start at the home page', toLabel: 'Go to the home page', body: 'Owners and managers see whether the business is making or losing money, what is owed, what is waiting for a decision, and what is about to expire or run out. Every card shows what it covers and for which period.' },
    { title: 'Ask for stock', toLabel: 'New stock request', body: 'A staff member asks for stock to leave a warehouse. The stock is set aside (reserved) straight away, but nothing leaves yet.' },
    { title: 'Approve it, as a different person', toLabel: 'Stock requests', body: 'A manager approves or rejects. The person who asked cannot approve their own request: the database refuses it, not just the screen. Only after approval can the stock be handed out.' },
    { title: 'Check the audit log', toLabel: 'Audit log', body: 'Every approval and every stock movement is written to a log in the same step, and nobody can edit or delete it. It shows who did what, and when.' },
    { title: 'See what will run out', toLabel: 'Stock forecast', body: "The forecast uses the company's own sales history to say when each item will run out, and says so when it has too little history to be sure. Alerts can tell the right people before it happens." },
  ],
  notReadyTitle: 'What is not ready yet',
  notReadyHint: 'So nobody is surprised: these are planned or partly built.',
  notReady: [
    '**Approvals by WhatsApp and by voice.** Designed and partly built, but not tested on a real phone. Approvals today are in the app.',
    '**Arabic.** Every screen. Each person chooses English or Arabic in Settings → General.',
    '**Accounting.** The profit figures are a management view (no VAT, cost is the average cost of stock). It is not a full ledger, tax return or Egypt e-invoicing.',
    '**Manufacturing.** No bill of materials or production orders yet, so profit for a factory is approximate.',
    '**Import and returns.** Importing items from a file and supplier returns are planned. Customer credit notes, debit notes and returns already exist: open a sales invoice and use Credit note or Debit note; another owner or manager approves them.',
    '**Sample data.** In the sample companies everything is invented and clearly marked.',
  ],
  draftNote: null,
};

const GUIDE_AR: GuideContent = {
  title: 'دليل الاستخدام',
  intro: 'كيف تجد طريقك داخل النظام، ومسار من خمس خطوات يوضح ما يفعله. هو نفسه للجميع: لا ترى إلا التطبيقات المسموح لك باستخدامها.',
  whereTitle: 'أين كل شيء',
  whereHint: 'افتح أي تطبيق من الصفحة الرئيسية أو من الروابط أدناه. داخل التطبيق تعرض القائمة الجانبية صفحاته.',
  fiveTitle: 'خمس خطوات لترى كيف يعمل',
  fiveHint: 'استعن بشخصين إن أمكن: أحدهما يطلب المخزون ومدير يوافق. لا يمكن للشخص نفسه أن يفعل الأمرين.',
  steps: [
    { title: 'ابدأ من الصفحة الرئيسية', toLabel: 'اذهب إلى الصفحة الرئيسية', body: 'يرى المالكون والمديرون هل يربح العمل أم يخسر، وما المستحق، وما ينتظر قرارًا، وما يوشك على الانتهاء أو النفاد. تعرض كل بطاقة ما تغطيه وفي أي فترة.' },
    { title: 'اطلب مخزونًا', toLabel: 'طلب مخزون جديد', body: 'يطلب أحد الموظفين خروج بضاعة من المخزن. تُحجز الكمية فورًا، لكن لا شيء يخرج بعد.' },
    { title: 'وافق عليه، بشخص مختلف', toLabel: 'طلبات المخزون', body: 'يوافق المدير أو يرفض. لا يستطيع مقدّم الطلب الموافقة على طلبه: قاعدة البيانات ترفض ذلك، وليس الشاشة فقط. وبعد الموافقة فقط يمكن تسليم البضاعة.' },
    { title: 'راجع سجل التدقيق', toLabel: 'سجل التدقيق', body: 'تُكتب كل موافقة وكل حركة مخزون في سجل في الخطوة نفسها، ولا يستطيع أحد تعديله أو حذفه. يُظهر من فعل ماذا ومتى.' },
    { title: 'اعرف ما سينفد', toLabel: 'توقعات المخزون', body: 'تستخدم التوقعات سجل مبيعات الشركة نفسها لتحديد متى سينفد كل صنف، وتذكر ذلك صراحة عندما يكون السجل قليلًا. ويمكن للتنبيهات إخبار الأشخاص المناسبين قبل حدوث ذلك.' },
  ],
  notReadyTitle: 'ما ليس جاهزًا بعد',
  notReadyHint: 'حتى لا يتفاجأ أحد: هذه أمور مخطط لها أو مبنية جزئيًا.',
  notReady: [
    '**الموافقات عبر واتساب والصوت.** مصمَّمة ومبنية جزئيًا، لكنها لم تُختبر على هاتف حقيقي. الموافقات اليوم داخل التطبيق.',
    '**العربية.** كل الشاشات. يختار كل شخص الإنجليزية أو العربية من الإعدادات ← عام.',
    '**المحاسبة.** أرقام الربح عرض إداري (دون ضريبة القيمة المضافة، والتكلفة هي متوسط تكلفة المخزون). وهي ليست دفتر أستاذ كاملًا ولا إقرارًا ضريبيًا ولا فاتورة إلكترونية لمصر.',
    '**التصنيع.** لا قائمة مواد ولا أوامر إنتاج بعد، لذا تكون الأرباح لمصنع تقريبية.',
    '**الاستيراد والمرتجعات.** استيراد الأصناف من ملف، ومرتجعات العملاء أو الموردين والإشعارات الدائنة، مخطط لها.',
    '**بيانات العينة.** في شركات العينة كل شيء مُختلَق ومُعلَّم بوضوح.',
  ],
  draftNote: null,
};

export const tutorialContent = (lang: Lang): TutorialContent => (lang === 'ar' ? TUTORIAL_AR : TUTORIAL_EN);
export const guideContent = (lang: Lang): GuideContent => (lang === 'ar' ? GUIDE_AR : GUIDE_EN);

/** Splits **bold** markers into runs. An unbalanced marker is kept as plain text, never dropped or thrown on. */
export function parseRich(text: string): { text: string; bold: boolean }[] {
  const parts = text.split('**');
  if (parts.length % 2 === 0) return [{ text, bold: false }];
  return parts.map((p, i) => ({ text: p, bold: i % 2 === 1 })).filter((r) => r.text !== '');
}
