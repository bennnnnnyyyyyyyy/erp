// The words of the guided tour, in English and Arabic. Steps are keyed by the ids in tourSteps.ts. The Arabic is a MACHINE DRAFT for a native
// speaker to review (the tour says so on its first step). Western digits are used on purpose, like the rest of the app.

import type { Lang } from '../../lib/i18n';

export type TourText = { title: string; body: string };

export type TourContent = {
  steps: Record<string, TourText>;
  tour: string;
  take: string;
  replay: string;
  next: string;
  back: string;
  finish: string;
  skip: string;
  close: string;
  stepOf: (i: number, n: number) => string;
  /** Shown on the first step in Arabic only: most screens are still English. */
  screenNote: string | null;
  draftNote: string | null;
  cancel: string;
};

const EN: TourContent = {
  steps: {
    home: { title: 'Management dashboard', body: 'Profit and loss, receivables and payables, pending approvals and inventory value with expiry, each with the period it covers. Every card opens the underlying list.' },
    'new-request': { title: 'Stock request', body: 'A user raises a request to issue goods from a warehouse. The quantity is reserved immediately; nothing is issued until approval.' },
    approve: { title: 'A second person approves', body: 'A manager approves or rejects the request. Nobody can approve their own request, so stock never leaves on one person\'s word. Goods are issued only after approval.' },
    ledger: { title: 'Stock ledger', body: 'Every stock movement, newest first. Nothing here can be edited or deleted, and every goods issue points to its approved request.' },
    audit: { title: 'Audit trail', body: 'Every approval and stock movement is recorded here at the moment it happens, with who did it. Nobody can change or remove it.' },
    alerts: { title: 'Alert rules', body: 'Rules notify the assigned users or teams of low stock, batches nearing expiry, overdue invoices and month-to-date losses, with one consolidated message per person.' },
    guide: { title: 'User guide', body: 'The Guide lists the modules available to you and known limitations. The tour can be restarted from Home, the Guide or Getting started.' },
  },
  tour: 'Tour',
  take: 'Take the tour',
  replay: 'Take the tour again',
  next: 'Next',
  back: 'Back',
  finish: 'Finish',
  skip: 'Skip the tour',
  close: 'Close the tour',
  stepOf: (i, n) => `Step ${i} of ${n}`,
  screenNote: null,
  draftNote: null,
  cancel: 'Cancel',
};

const AR: TourContent = {
  steps: {
    home: { title: 'لوحة الإدارة', body: 'الأرباح والخسائر، والذمم المدينة والدائنة، والموافقات المعلّقة، وقيمة المخزون مع الصلاحية، مع الفترة التي تغطيها كل بطاقة. تفتح كل بطاقة القائمة المرتبطة بها.' },
    'new-request': { title: 'طلب مخزون', body: 'ينشئ المستخدم طلبًا لصرف بضائع من مستودع. تُحجز الكمية فورًا، ولا يُصرف شيء قبل الاعتماد.' },
    approve: { title: 'شخص آخر يعتمد', body: 'يعتمد المدير الطلب أو يرفضه. لا يستطيع أحد اعتماد طلبه بنفسه، فلا يخرج المخزون بكلمة شخص واحد. ولا تُصرف البضائع إلا بعد الاعتماد.' },
    ledger: { title: 'سجل المخزون', body: 'كل حركة مخزون، الأحدث أولًا. لا يمكن تعديل أي شيء هنا أو حذفه، وكل عملية صرف ترتبط بطلبها المعتمد.' },
    audit: { title: 'سجل التدقيق', body: 'تُسجَّل هنا كل موافقة وحركة مخزون لحظة حدوثها ومن قام بها. لا يستطيع أحد تغييرها أو حذفها.' },
    alerts: { title: 'قواعد التنبيه', body: 'تُبلغ القواعد المستخدمين أو الفرق المحددة بانخفاض المخزون، والتشغيلات القريبة من انتهاء الصلاحية، والفواتير المتأخرة، وخسائر الشهر الجاري، برسالة مجمّعة واحدة لكل شخص.' },
    guide: { title: 'دليل المستخدم', body: 'يعرض الدليل الوحدات المتاحة لك والقيود المعروفة. يمكن إعادة الجولة من الصفحة الرئيسية أو الدليل أو صفحة البدء.' },
  },
  tour: 'جولة',
  take: 'ابدأ الجولة',
  replay: 'أعد الجولة',
  next: 'التالي',
  back: 'السابق',
  finish: 'إنهاء',
  skip: 'تخطي الجولة',
  close: 'إغلاق الجولة',
  stepOf: (i, n) => `الخطوة ${i} من ${n}`,
  screenNote: 'ملاحظة: معظم الشاشات ما زالت بالإنجليزية، وستظهر هكذا أثناء الجولة.',
  draftNote: 'النص العربي مسودة أولى بالترجمة الآلية وبانتظار مراجعة متحدث أصلي.',
  cancel: 'إلغاء',
};

export const tourContent = (lang: Lang): TourContent => (lang === 'ar' ? AR : EN);
