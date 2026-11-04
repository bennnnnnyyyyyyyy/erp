import type { Lang } from '../../lib/i18n';

// The words of the first-run setup wizard (Onboarding.tsx), in both languages. Same pattern as helpContent.ts: every sentence lives
// here, never in the component, and onboarding.test.ts fails if the two languages drift apart. The Arabic is a first draft awaiting
// review by a native speaker.

export type StepKey = 'welcome' | 'language' | 'company' | 'storage' | 'warehouse' | 'items' | 'suppliers' | 'customers' | 'team' | 'approval' | 'done';
export const STEP_KEYS: StepKey[] = ['welcome', 'language', 'company', 'storage', 'warehouse', 'items', 'suppliers', 'customers', 'team', 'approval', 'done'];
export type FillStageKey = 'company' | 'storage' | 'warehouses' | 'items' | 'suppliers' | 'customers' | 'approval';

export type OnboardingContent = {
  stepOf: (n: number, total: number) => string;
  back: string;
  next: string;
  skip: string;
  save: string;
  saving: string;
  saved: string;
  notAllowed: string;
  exit: string;
  steps: Record<StepKey, { title: string; body: string }>;
  welcome: { start: string; later: string; points: string[] };
  language: { personal: string; company: string; companyHint: string };
  company: { name: string; currency: string; timezone: string; dateFormat: string };
  warehouse: { code: string; codeHint: string; name: string; existing: (n: number) => string };
  items: { sku: string; name: string; unit: string; opening: string; cost: string; addRow: string; existing: (n: number) => string; needWarehouse: string };
  team: { email: string; fullName: string; role: string; roles: Record<'admin' | 'member' | 'viewer', string>; invite: string; invited: (email: string) => string; existing: (n: number) => string };
  approval: { always: string; minQty: string; minQtyHint: string; approvers: string; existing: (n: number) => string };
  done: { tour: string; home: string; checklist: string };
  storage: { name: string; min: string; max: string; existing: (n: number) => string };
  party: { name: string; contact: string; city: string; add: string; added: (name: string) => string; existing: (n: number) => string };
  fill: {
    one: string;
    all: string;
    allHint: string;
    working: (done: number, total: number) => string;
    result: (added: number, skipped: number) => string;
    failed: string;
    stages: Record<FillStageKey, string>;
    continueTeam: string;
  };
};

const EN: OnboardingContent = {
  stepOf: (n, total) => `Step ${n} of ${total}`,
  back: 'Back',
  next: 'Next',
  skip: 'Skip this step',
  save: 'Save and continue',
  saving: 'Saving…',
  saved: 'Saved',
  notAllowed: 'Only an owner or admin can change this. You can skip it; they can do it later.',
  exit: 'Leave setup (you can come back from Getting started)',
  steps: {
    welcome: { title: 'Welcome', body: 'This app runs your warehouse, buying and selling, with a manager approval on every outgoing stock movement and a history nobody can change. A few short steps set up your company; every step can be skipped and changed later.' },
    language: { title: 'Your language', body: 'Choose the language you want to use. The layout turns right to left for Arabic.' },
    company: { title: 'Your company', body: 'These appear on your documents and decide how money, dates and times are shown.' },
    storage: { title: 'Storage conditions', body: 'Some goods must stay cool. A storage condition (for example a cold room at 2 to 8 °C) stops cold items being put in a warm warehouse.' },
    suppliers: { title: 'Your suppliers', body: 'The companies you buy from. Purchase orders and supplier invoices use them.' },
    customers: { title: 'Your customers', body: 'The companies you sell to. Sales orders and invoices use them.' },
    warehouse: { title: 'Your first warehouse', body: 'Stock always sits in a warehouse. Add the main one now; you can add more later.' },
    items: { title: 'Your items', body: 'Add a few of the items you stock, with the quantity you have today. You can add the rest later.' },
    team: { title: 'Your team', body: 'Invite the people who will work with you. A manager (admin) approves; a member requests and receives.' },
    approval: { title: 'Approvals', body: 'Every outgoing stock movement needs a manager\'s approval, and nobody can approve their own request. You can ask for more than one approver on large requests.' },
    done: { title: 'You are set up', body: 'Your company is ready. Take the short tour to see the main screens, or go straight to the home page.' },
  },
  welcome: {
    start: 'Start setup',
    later: 'Not now',
    points: ['Choose your language', 'Check your company details', 'Add your warehouses and items', 'Add your suppliers and customers', 'Invite your team', 'Set how approvals work'],
  },
  language: {
    personal: 'My language',
    company: 'Also make this the default for everyone in the company',
    companyHint: 'Each person can still pick their own language under Settings.',
  },
  company: { name: 'Company name', currency: 'Currency', timezone: 'Time zone', dateFormat: 'Date format' },
  warehouse: {
    code: 'Code',
    codeHint: 'Letters and numbers, e.g. MAIN',
    name: 'Name',
    existing: (n) => `You already have ${n} warehouse(s). Add another, or continue.`,
  },
  items: {
    sku: 'Code (SKU)',
    name: 'Name',
    unit: 'Unit',
    opening: 'In stock now',
    cost: 'Cost each',
    addRow: 'Add another item',
    existing: (n) => `You already have ${n} item(s). Add more, or continue.`,
    needWarehouse: 'Add a warehouse first (previous step) so the opening stock has somewhere to go.',
  },
  team: {
    email: 'Email',
    fullName: 'Full name',
    role: 'Role',
    roles: { admin: 'Manager (approves)', member: 'Member (requests and receives)', viewer: 'Viewer (read only)' },
    invite: 'Invite',
    invited: (email) => `Invitation sent to ${email}`,
    existing: (n) => `Your company has ${n} person(s).`,
  },
  approval: {
    always: 'One manager\'s approval is always required, and the requester can never approve their own request. This cannot be switched off.',
    minQty: 'From this total quantity',
    minQtyHint: 'Requests at or above this total quantity need the number of approvers below.',
    approvers: 'Approvers needed',
    existing: (n) => `You already have ${n} approval rule(s). Add another, or continue.`,
  },
  done: { tour: 'Take the tour', home: 'Go to the home page', checklist: 'Open the setup checklist' },
  storage: { name: 'Name', min: 'Lowest °C', max: 'Highest °C', existing: (n) => `You already have ${n} storage condition(s).` },
  party: { name: 'Name', contact: 'Contact', city: 'City', add: 'Add', added: (name) => `Added ${name}`, existing: (n) => `You already have ${n}.` },
  fill: {
    one: 'Fill with sample data',
    all: 'Fill everything with sample data',
    allHint: 'Adds the cosmetics sample company in one go: warehouses, items with stock and costs, suppliers, customers and an approval rule. Your company name, language and team stay as you set them.',
    working: (done, total) => `Saving ${done} of ${total}…`,
    result: (added, skipped) => `Added ${added}; ${skipped} already there.`,
    failed: 'Could not add:',
    stages: { company: 'Company settings', storage: 'Storage conditions', warehouses: 'Warehouses', items: 'Items', suppliers: 'Suppliers', customers: 'Customers', approval: 'Approval rule' },
    continueTeam: 'Continue: invite your team',
  },
};

const AR: OnboardingContent = {
  stepOf: (n, total) => `الخطوة ${n} من ${total}`,
  back: 'السابق',
  next: 'التالي',
  skip: 'تخطَّ هذه الخطوة',
  save: 'احفظ وتابع',
  saving: 'جارٍ الحفظ…',
  saved: 'تم الحفظ',
  notAllowed: 'يستطيع المالك أو المدير فقط تغيير هذا. يمكنك تخطيه، ويمكنهم القيام به لاحقًا.',
  exit: 'اترك الإعداد (يمكنك العودة من صفحة البدء)',
  steps: {
    welcome: { title: 'مرحبًا بك', body: 'يدير هذا التطبيق مستودعك ومشترياتك ومبيعاتك، مع موافقة مدير على كل حركة مخزون صادرة وسجل لا يمكن لأحد تغييره. بضع خطوات قصيرة تُعدّ شركتك؛ ويمكن تخطي كل خطوة وتغييرها لاحقًا.' },
    language: { title: 'لغتك', body: 'اختر اللغة التي تريد استخدامها. يتحول اتجاه الصفحة من اليمين إلى اليسار مع العربية.' },
    company: { title: 'شركتك', body: 'تظهر هذه البيانات على مستنداتك وتحدد طريقة عرض المبالغ والتواريخ والأوقات.' },
    storage: { title: 'ظروف التخزين', body: 'بعض البضائع يجب أن تبقى باردة. تمنع ظروف التخزين (مثل غرفة تبريد من 2 إلى 8 درجات) وضع الأصناف المبرّدة في مستودع دافئ.' },
    suppliers: { title: 'مورّدوك', body: 'الشركات التي تشتري منها. تستخدمها أوامر الشراء وفواتير المورّدين.' },
    customers: { title: 'عملاؤك', body: 'الشركات التي تبيع لها. تستخدمها أوامر البيع والفواتير.' },
    warehouse: { title: 'مستودعك الأول', body: 'يوجد المخزون دائمًا في مستودع. أضف المستودع الرئيسي الآن، ويمكنك إضافة غيره لاحقًا.' },
    items: { title: 'أصنافك', body: 'أضف بعض الأصناف التي تخزّنها مع الكمية الموجودة لديك اليوم. يمكنك إضافة الباقي لاحقًا.' },
    team: { title: 'فريقك', body: 'ادعُ الأشخاص الذين سيعملون معك. المدير يوافق، والعضو يطلب ويستلم.' },
    approval: { title: 'الموافقات', body: 'تحتاج كل حركة مخزون صادرة إلى موافقة مدير، ولا يستطيع أحد الموافقة على طلبه بنفسه. يمكنك طلب أكثر من موافِق للطلبات الكبيرة.' },
    done: { title: 'اكتمل الإعداد', body: 'شركتك جاهزة. خذ الجولة القصيرة لترى الشاشات الرئيسية، أو انتقل مباشرة إلى الصفحة الرئيسية.' },
  },
  welcome: {
    start: 'ابدأ الإعداد',
    later: 'ليس الآن',
    points: ['اختر لغتك', 'راجع بيانات شركتك', 'أضف مستودعاتك وأصنافك', 'أضف مورّديك وعملاءك', 'ادعُ فريقك', 'حدّد طريقة عمل الموافقات'],
  },
  language: {
    personal: 'لغتي',
    company: 'اجعلها أيضًا اللغة الافتراضية لكل من في الشركة',
    companyHint: 'يستطيع كل شخص اختيار لغته من الإعدادات.',
  },
  company: { name: 'اسم الشركة', currency: 'العملة', timezone: 'المنطقة الزمنية', dateFormat: 'تنسيق التاريخ' },
  warehouse: {
    code: 'الرمز',
    codeHint: 'حروف وأرقام، مثل MAIN',
    name: 'الاسم',
    existing: (n) => `لديك بالفعل ${n} مستودع. أضف مستودعًا آخر أو تابع.`,
  },
  items: {
    sku: 'رمز الصنف (SKU)',
    name: 'الاسم',
    unit: 'الوحدة',
    opening: 'الموجود الآن',
    cost: 'تكلفة الوحدة',
    addRow: 'أضف صنفًا آخر',
    existing: (n) => `لديك بالفعل ${n} صنف. أضف المزيد أو تابع.`,
    needWarehouse: 'أضف مستودعًا أولًا (الخطوة السابقة) ليكون للمخزون الافتتاحي مكان.',
  },
  team: {
    email: 'البريد الإلكتروني',
    fullName: 'الاسم الكامل',
    role: 'الدور',
    roles: { admin: 'مدير (يوافق)', member: 'عضو (يطلب ويستلم)', viewer: 'مشاهد (قراءة فقط)' },
    invite: 'إرسال الدعوة',
    invited: (email) => `أُرسلت الدعوة إلى ${email}`,
    existing: (n) => `في شركتك ${n} شخص.`,
  },
  approval: {
    always: 'موافقة مدير واحد مطلوبة دائمًا، ولا يستطيع مقدّم الطلب الموافقة على طلبه أبدًا. لا يمكن إيقاف ذلك.',
    minQty: 'ابتداءً من هذه الكمية الإجمالية',
    minQtyHint: 'الطلبات التي تبلغ هذه الكمية الإجمالية أو تزيد عليها تحتاج إلى عدد الموافِقين أدناه.',
    approvers: 'عدد الموافِقين المطلوب',
    existing: (n) => `لديك بالفعل ${n} قاعدة موافقة. أضف قاعدة أخرى أو تابع.`,
  },
  done: { tour: 'خذ الجولة', home: 'انتقل إلى الصفحة الرئيسية', checklist: 'افتح قائمة الإعداد' },
  storage: { name: 'الاسم', min: 'أدنى درجة °م', max: 'أعلى درجة °م', existing: (n) => `لديك بالفعل ${n} من ظروف التخزين.` },
  party: { name: 'الاسم', contact: 'جهة الاتصال', city: 'المدينة', add: 'إضافة', added: (name) => `تمت إضافة ${name}`, existing: (n) => `لديك بالفعل ${n}.` },
  fill: {
    one: 'املأ ببيانات تجريبية',
    all: 'املأ كل شيء ببيانات تجريبية',
    allHint: 'يضيف شركة مستحضرات التجميل التجريبية دفعة واحدة: المستودعات، والأصناف مع مخزونها وتكلفتها، والمورّدين، والعملاء، وقاعدة موافقة. يبقى اسم شركتك ولغتك وفريقك كما حددتها.',
    working: (done, total) => `جارٍ حفظ ${done} من ${total}…`,
    result: (added, skipped) => `أُضيف ${added}؛ و${skipped} موجود بالفعل.`,
    failed: 'تعذرت إضافة:',
    stages: { company: 'إعدادات الشركة', storage: 'ظروف التخزين', warehouses: 'المستودعات', items: 'الأصناف', suppliers: 'المورّدون', customers: 'العملاء', approval: 'قاعدة الموافقة' },
    continueTeam: 'تابع: ادعُ فريقك',
  },
};

export const onboardingContent = (lang: Lang): OnboardingContent => (lang === 'ar' ? AR : EN);

// ---- progress, kept in this browser per company (like the tour's done flag). Nothing here is a business record.

const key = (orgId: string) => `erp.onboarding.${orgId}`;

export type Progress = { step: number; done: boolean };

export function readProgress(orgId: string, storage: Pick<Storage, 'getItem'> = localStorage): Progress {
  try {
    const raw = storage.getItem(key(orgId));
    const p = raw ? (JSON.parse(raw) as Partial<Progress>) : {};
    const step = Number.isInteger(p.step) && (p.step as number) >= 0 && (p.step as number) < STEP_KEYS.length ? (p.step as number) : 0;
    return { step, done: p.done === true };
  } catch {
    return { step: 0, done: false };
  }
}

export function writeProgress(orgId: string, p: Progress, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(key(orgId), JSON.stringify(p));
  } catch {
    // private mode or full storage: the wizard still works, it just starts at the beginning next time
  }
}

/**
 * Whether Home should open the wizard by itself: only for someone who can manage the company, only in a company that shows the
 * Getting-started tutorial (new companies; sql/032), only while it has no warehouse yet (a brand-new company), and never again once
 * the wizard was finished or dismissed in this browser.
 */
export function shouldAutoStart(a: { showTutorial: boolean; canManage: boolean; warehouses: number | null; progress: Progress; dismissed: boolean }): boolean {
  return a.showTutorial && a.canManage && a.warehouses === 0 && !a.progress.done && !a.dismissed;
}
