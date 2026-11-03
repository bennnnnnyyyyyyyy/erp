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
    home: { title: 'Start here', body: 'The home page says, in plain words, whether the business is making or losing money, what is owed, what is waiting for a decision and what is about to expire. Each card shows what it covers and for which period.' },
    'new-request': { title: 'Ask for stock', body: 'A staff member asks for stock to leave a warehouse. The quantity is set aside (reserved) at once, but nothing leaves yet.' },
    approve: { title: 'A different person approves', body: 'A manager approves or rejects. Whoever asked cannot approve their own request: the database refuses it, not only the screen. Only after approval can the stock be handed out.' },
    ledger: { title: 'Every movement is recorded', body: 'The ledger lists every stock movement, newest first. Entries are only ever added, never edited or deleted, and an outgoing movement always points to an approved request.' },
    audit: { title: 'Who did what, and when', body: 'Every approval and every stock movement is written to this log in the same step, and nobody can change or remove it.' },
    alerts: { title: 'Let the system watch for you', body: 'Alerts tell the right people when stock is low, a batch is about to expire, an invoice is late or the month is losing money: one message per person, not one per item.' },
    guide: { title: 'Where to read more', body: 'The Guide lists every app you can use and what is not ready yet. You can take this tour again from the Guide or from the Getting started page.' },
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
    home: { title: 'ابدأ من هنا', body: 'تعرض الصفحة الرئيسية بلغة بسيطة هل يربح العمل أم يخسر، وما المبالغ المستحقة، وما ينتظر قرارًا، وما يوشك على الانتهاء. وتوضح كل بطاقة ما تغطيه والفترة الزمنية.' },
    'new-request': { title: 'اطلب مخزونًا', body: 'يطلب أحد الموظفين خروج بضاعة من المخزن. تُحجز الكمية فورًا، لكن لا شيء يخرج بعد.' },
    approve: { title: 'يوافق شخص آخر', body: 'يوافق المدير على الطلب أو يرفضه. ولا يستطيع مقدّم الطلب الموافقة على طلبه: فقاعدة البيانات تمنع ذلك، وليس الشاشة فقط. ولا تُسلَّم البضاعة إلا بعد الموافقة.' },
    ledger: { title: 'كل حركة مسجّلة', body: 'يعرض السجل كل حركة مخزون، الأحدث أولًا. تُضاف السجلات ولا تُعدَّل ولا تُحذف، وكل حركة خروج مرتبطة دائمًا بطلب تمت الموافقة عليه.' },
    audit: { title: 'من فعل ماذا ومتى', body: 'تُكتب كل موافقة وكل حركة مخزون في هذا السجل في الخطوة نفسها، ولا يستطيع أحد تغييرها أو حذفها.' },
    alerts: { title: 'دع النظام يراقب عنك', body: 'تُبلِّغ التنبيهات الأشخاص المناسبين عند انخفاض المخزون، أو قرب انتهاء صلاحية دفعة، أو تأخر فاتورة، أو خسارة الشهر: رسالة واحدة لكل شخص وليست رسالة لكل صنف.' },
    guide: { title: 'للمزيد', body: 'يعرض دليل الاستخدام كل التطبيقات المتاحة لك وما ليس جاهزًا بعد. ويمكنك إعادة هذه الجولة من دليل الاستخدام أو من صفحة البدء.' },
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
