import type { Lang } from '../../lib/i18n';

// The words of the first-run setup wizard (Onboarding.tsx), in both languages. Same pattern as helpContent.ts: every sentence lives
// here, never in the component, and onboarding.test.ts fails if the two languages drift apart. The Arabic is a first draft awaiting
// review by a native speaker.

export type StepKey = 'welcome' | 'business' | 'company' | 'storage' | 'warehouse' | 'items' | 'suppliers' | 'customers' | 'team' | 'approval' | 'done';
export const STEP_KEYS: StepKey[] = ['welcome', 'business', 'company', 'storage', 'warehouse', 'items', 'suppliers', 'customers', 'team', 'approval', 'done'];

// Decision D9 (Ben, 9 Nov 2026): the wizard first asks "What do you sell?" and shows only the steps that fit. The language step is gone
// (language is already chosen at sign-up and in the first-run language chooser).
export const BUSINESS_TYPES = ['shop', 'food', 'medicine', 'cosmetics', 'building', 'other'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
/** Goods that may need a cold room or a temperature range: only these see the storage conditions step. */
export const needsStorage = (b: BusinessType | null | undefined) => b === 'food' || b === 'medicine' || b === 'cosmetics';
/** The steps shown for a business; before the question is answered, every step (the storage step is decided by the answer). */
export function stepsFor(b: BusinessType | null | undefined): StepKey[] {
  return STEP_KEYS.filter((k) => k !== 'storage' || !b || needsStorage(b));
}
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
  /** Shown after a column or field that may be left empty. */
  optional: string;
  steps: Record<StepKey, { title: string; body: string }>;
  welcome: { start: string; later: string; points: string[] };
  business: { options: Record<BusinessType, { label: string; hint: string }>; unitHint: Record<BusinessType, string> };
  company: { name: string; currency: string; timezone: string; dateFormat: string };
  warehouse: { code: string; codeHint: string; name: string; condition: string; conditionHint: string; existing: (n: number) => string };
  items: { sku: string; name: string; nameAr: string; warehouse: string; unit: string; opening: string; cost: string; addRow: string; existing: (n: number) => string; needWarehouse: string };
  team: { email: string; fullName: string; role: string; roles: Record<'admin' | 'member' | 'viewer', string>; invite: string; invited: (email: string) => string; existing: (n: number) => string };
  approval: { always: string; minQty: string; minQtyHint: string; approvers: string; existing: (n: number) => string };
  done: { tour: string; home: string; checklist: string };
  /** "Explore more": each step links to the real screen it sets up (opens in a new tab, so the wizard stays where it is). */
  explore: { label: string; hint: string; screens: Record<StepKey, string> };
  storage: { name: string; min: string; max: string; skipHint: string; existing: (n: number) => string };
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
  optional: 'optional',
  steps: {
    welcome: { title: 'Welcome', body: 'This app runs your warehouse, buying and selling, with a manager approval on every outgoing stock movement and a history nobody can change. A few short steps set up your company; every step can be skipped and changed later.' },
    business: { title: 'What do you sell?', body: 'Choose the closest. Setup then shows only the steps that fit your business; you can change your mind on this step at any time.' },
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
    points: ['Tell us what you sell', 'Check your company details', 'Add your warehouses and items', 'Add your suppliers and customers', 'Invite your team', 'Set how approvals work'],
  },
  business: {
    options: {
      shop: { label: 'A shop or general trading', hint: 'Clothes, electronics, home goods, spare parts…' },
      food: { label: 'Food or drinks', hint: 'Groceries, dairy, frozen food, drinks…' },
      medicine: { label: 'Medicine', hint: 'A pharmacy or medicine distribution' },
      cosmetics: { label: 'Cosmetics', hint: 'Creams, perfumes, personal care…' },
      building: { label: 'Building materials', hint: 'Cement, steel, tiles, paint…' },
      other: { label: 'Something else', hint: 'Any other goods' },
    },
    unitHint: {
      shop: 'Units are usually piece, box or carton.',
      food: 'Units are usually kg, carton or crate; goods that must stay cold can get a storage condition (previous step).',
      medicine: 'Units are usually box, strip or bottle; medicines that need a cool place can get a storage condition (previous step).',
      cosmetics: 'Units are usually piece, bottle or carton; products that need a cool place can get a storage condition (previous step).',
      building: 'Units are usually ton, bag, m² or m³.',
      other: 'Use the unit you count stock in: piece, kg, box…',
    },
  },
  company: { name: 'Company name', currency: 'Currency', timezone: 'Time zone', dateFormat: 'Date format' },
  warehouse: {
    code: 'Code',
    codeHint: 'Letters and numbers, e.g. MAIN',
    name: 'Name',
    condition: 'Storage condition',
    conditionHint: 'Most warehouses need no storage condition: leave it empty. Fill it in only for a place such as a cold room.',
    existing: (n) => `You already have ${n} warehouse(s). Add another, or continue.`,
  },
  items: {
    sku: 'Code (SKU)',
    name: 'Name',
    nameAr: 'Name in Arabic',
    warehouse: 'Warehouse',
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
    invite: 'Add and get their link',
    invited: (email) => `Added ${email}. Send them their sign-in link (shown above).`,
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
  explore: {
    label: 'Explore more',
    hint: 'opens in a new tab; setup stays here',
    screens: {
      welcome: 'The user guide',
      business: 'The user guide',
      company: 'Settings: General',
      storage: 'Inventory: Batches and expiry',
      warehouse: 'Inventory: Stock on hand',
      items: 'Inventory: Stock on hand',
      suppliers: 'Purchasing: Suppliers',
      customers: 'Sales: Customers',
      team: 'Settings: Users',
      approval: 'Inventory: Approval policies',
      done: 'The home page',
    },
  },
  storage: { name: 'Name', min: 'Lowest °C', max: 'Highest °C', skipHint: 'This step is optional. If none of your goods need special storage, skip it.', existing: (n) => `You already have ${n} storage condition(s).` },
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
  optional: 'اختياري',
  steps: {
    welcome: { title: 'مرحبًا بك', body: 'يدير هذا التطبيق مستودعك ومشترياتك ومبيعاتك، مع موافقة مدير على كل حركة مخزون صادرة وسجل لا يمكن لأحد تغييره. بضع خطوات قصيرة تُعدّ شركتك؛ ويمكن تخطي كل خطوة وتغييرها لاحقًا.' },
    business: { title: 'ماذا تبيع؟', body: 'اختر الأقرب. بعدها يعرض الإعداد الخطوات التي تناسب نشاطك فقط، ويمكنك تغيير اختيارك في هذه الخطوة في أي وقت.' },
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
    points: ['أخبرنا بما تبيعه', 'راجع بيانات شركتك', 'أضف مستودعاتك وأصنافك', 'أضف مورّديك وعملاءك', 'ادعُ فريقك', 'حدّد طريقة عمل الموافقات'],
  },
  // MACHINE DRAFT (10 Nov): the business question, listed in the Arabic review sheet
  business: {
    options: {
      shop: { label: 'محل أو تجارة عامة', hint: 'ملابس، إلكترونيات، أدوات منزلية، قطع غيار…' },
      food: { label: 'أغذية أو مشروبات', hint: 'بقالة، ألبان، مجمدات، مشروبات…' },
      medicine: { label: 'أدوية', hint: 'صيدلية أو توزيع أدوية' },
      cosmetics: { label: 'مستحضرات تجميل', hint: 'كريمات، عطور، عناية شخصية…' },
      building: { label: 'مواد بناء', hint: 'أسمنت، حديد، سيراميك، دهانات…' },
      other: { label: 'شيء آخر', hint: 'أي بضائع أخرى' },
    },
    unitHint: {
      shop: 'الوحدات عادةً: قطعة أو علبة أو كرتونة.',
      food: 'الوحدات عادةً: كجم أو كرتونة أو صندوق؛ ويمكن إعطاء البضائع التي يجب أن تبقى باردة ظرف تخزين (الخطوة السابقة).',
      medicine: 'الوحدات عادةً: علبة أو شريط أو زجاجة؛ ويمكن إعطاء الأدوية التي تحتاج إلى مكان بارد ظرف تخزين (الخطوة السابقة).',
      cosmetics: 'الوحدات عادةً: قطعة أو زجاجة أو كرتونة؛ ويمكن إعطاء المنتجات التي تحتاج إلى مكان بارد ظرف تخزين (الخطوة السابقة).',
      building: 'الوحدات عادةً: طن أو شيكارة أو م² أو م³.',
      other: 'استخدم الوحدة التي تعدّ بها مخزونك: قطعة، كجم، علبة…',
    },
  },
  company: { name: 'اسم الشركة', currency: 'العملة', timezone: 'المنطقة الزمنية', dateFormat: 'تنسيق التاريخ' },
  warehouse: {
    code: 'الرمز',
    codeHint: 'حروف وأرقام، مثل MAIN',
    name: 'الاسم',
    condition: 'ظرف التخزين',
    conditionHint: 'معظم المستودعات لا تحتاج إلى ظرف تخزين: اتركه فارغًا. املأه فقط لمكان مثل غرفة التبريد.',
    existing: (n) => `لديك بالفعل ${n} مستودع. أضف مستودعًا آخر أو تابع.`,
  },
  items: {
    sku: 'رمز الصنف (SKU)',
    name: 'الاسم',
    nameAr: 'الاسم بالعربية',
    warehouse: 'المستودع',
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
    invite: 'إضافة',
    invited: (email) => `أُضيف ${email}. أرسل له رابط الدخول (الظاهر أعلاه).`,
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
  explore: {
    label: 'استكشف المزيد',
    hint: 'يُفتح في علامة تبويب جديدة؛ ويبقى الإعداد هنا',
    screens: {
      welcome: 'دليل الاستخدام',
      business: 'دليل الاستخدام',
      company: 'الإعدادات: عام',
      storage: 'المخزون: الدفعات وتواريخ الانتهاء',
      warehouse: 'المخزون: المخزون المتاح',
      items: 'المخزون: المخزون المتاح',
      suppliers: 'المشتريات: المورّدون',
      customers: 'المبيعات: العملاء',
      team: 'الإعدادات: المستخدمون',
      approval: 'المخزون: سياسات الموافقة',
      done: 'الصفحة الرئيسية',
    },
  },
  storage: { name: 'الاسم', min: 'أدنى درجة °م', max: 'أعلى درجة °م', skipHint: 'هذه الخطوة اختيارية. إذا لم تكن بضائعك تحتاج إلى تخزين خاص فتخطَّها.', existing: (n) => `لديك بالفعل ${n} من ظروف التخزين.` },
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

/** step: the position in the steps shown for `business` (stepsFor). business: the answer to "What do you sell?", once given. */
export type Progress = { step: number; done: boolean; business?: BusinessType | null };

export function readProgress(orgId: string, storage: Pick<Storage, 'getItem'> = localStorage): Progress {
  try {
    const raw = storage.getItem(key(orgId));
    const p = raw ? (JSON.parse(raw) as Partial<Progress>) : {};
    const business = (BUSINESS_TYPES as readonly string[]).includes(p.business as string) ? (p.business as BusinessType) : null;
    const count = stepsFor(business).length;
    const step = Number.isInteger(p.step) && (p.step as number) >= 0 && (p.step as number) < count ? (p.step as number) : 0;
    return { step, done: p.done === true, business };
  } catch {
    return { step: 0, done: false, business: null };
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
