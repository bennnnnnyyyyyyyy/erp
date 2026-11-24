// Arabic for scanning (phase 1d, sql/108): AI providers that read bills, scanning supplier bills, attachments, barcodes and QR codes.
// MACHINE DRAFT: Ben reviews it with the Arabic review sheet.
export const SCANNING_AR: Record<string, string> = {
  // step 0: AI providers
  'Google Gemini': 'جوجل جيميناي',
  'Claude (Anthropic)': 'Claude (أنثروبيك)',
  'Grok (xAI)': 'Grok (xAI)',
  OpenRouter: 'OpenRouter',
  "Reads supplier bills (photos and PDFs) with your own Google AI key. Needs the owner's consent: the bill is sent to Google.":
    'يقرأ فواتير الموردين (صور وملفات PDF) بمفتاح Google AI الخاص بك. يحتاج موافقة المالك: تُرسل الفاتورة إلى جوجل.',
  "Reads supplier bills (photos and PDFs) with your own Anthropic key. Needs the owner's consent: the bill is sent to Anthropic.":
    'يقرأ فواتير الموردين (صور وملفات PDF) بمفتاح Anthropic الخاص بك. يحتاج موافقة المالك: تُرسل الفاتورة إلى أنثروبيك.',
  "Reads supplier bills (photos only, not PDF) with your own xAI key. Needs the owner's consent: the bill is sent to xAI.":
    'يقرأ فواتير الموردين (صور فقط، وليس PDF) بمفتاح xAI الخاص بك. يحتاج موافقة المالك: تُرسل الفاتورة إلى xAI.',
  "Reads supplier bills with your own OpenRouter key and the model you choose there. Needs the owner's consent: the bill is sent to OpenRouter and that model's provider.":
    'يقرأ فواتير الموردين بمفتاح OpenRouter الخاص بك والنموذج الذي تختاره هناك. يحتاج موافقة المالك: تُرسل الفاتورة إلى OpenRouter وإلى مزوّد ذلك النموذج.',
  'Your API key': 'مفتاح API الخاص بك',
  Model: 'النموذج',
  'Google AI Studio → Get API key.': 'Google AI Studio ← Get API key.',
  'Claude Console → API keys.': 'Claude Console ← API keys.',
  'xAI console → API keys.': 'لوحة xAI ← API keys.',
  'A Grok model that reads images.': 'نموذج Grok يقرأ الصور.',
  'A model that reads images.': 'نموذج يقرأ الصور.',
  'Reading supplier bills': 'قراءة فواتير الموردين',
  'Reads supplier bills': 'يقرأ فواتير الموردين',
  'Use this AI to read supplier bills': 'استخدم هذا الذكاء الاصطناعي لقراءة فواتير الموردين',
  'Stop choosing it': 'إلغاء اختياره',
  '{name} now reads your supplier bills.': '{name} يقرأ الآن فواتير الموردين.',
  'No AI is chosen: the first one that is on reads bills.': 'لم يُختر ذكاء اصطناعي: أول واحد مُفعَّل يقرأ الفواتير.',
  'Reading supplier bills needs your own key here. We do not give a shared key for it.':
    'قراءة فواتير الموردين تحتاج مفتاحك الخاص هنا. لا نوفّر مفتاحًا مشتركًا لذلك.',
  'When AI is on, the text you ask about, the related company records, voice recordings, or the photos and PDFs of supplier bills you scan are sent to the AI provider you switch on to produce an answer: OpenAI, ElevenLabs, Google Gemini, Claude (Anthropic), Grok (xAI) or OpenRouter (and the model provider you choose there), or, with Ollama, the server at the address you enter, which our servers reach over the internet. The AI only suggests: it never changes or saves data by itself, and only sees what the person asking is allowed to see.':
    'عند تشغيل الذكاء الاصطناعي، يُرسل النص الذي تسأل عنه وسجلات الشركة المتعلقة به أو التسجيلات الصوتية أو صور وملفات PDF لفواتير الموردين التي تمسحها إلى مزوّد الذكاء الاصطناعي الذي تشغّله ليعطي إجابة: OpenAI أو ElevenLabs أو Google Gemini أو Claude (أنثروبيك) أو Grok (xAI) أو OpenRouter (ومزوّد النموذج الذي تختاره هناك)، أو مع Ollama، الخادم على العنوان الذي تدخله، والذي تصل إليه خوادمنا عبر الإنترنت. الذكاء الاصطناعي يقترح فقط: لا يغيّر ولا يحفظ أي بيانات بنفسه، ولا يرى إلا ما يحق للشخص السائل رؤيته.',
  // step 1: scan a supplier bill
  'Scan a bill': 'مسح فاتورة',
  'Take a photo of the bill or choose a PDF. Your company’s AI reads it and fills in a draft. Check it, then save. Nothing is saved before you click Save.':
    'صوّر الفاتورة أو اختر ملف PDF. يقرؤها الذكاء الاصطناعي الخاص بشركتك ويملأ مسودة. راجعها ثم احفظها. لا يُحفظ شيء قبل أن تضغط «حفظ».',
  'Take a photo': 'التقاط صورة',
  'Choose a picture or PDF': 'اختيار صورة أو PDF',
  'Reading the bill…': 'جارٍ قراءة الفاتورة…',
  'The scanned bill': 'الفاتورة الممسوحة',
  'Open the PDF': 'فتح ملف PDF',
  'Read by {provider} ({model}). Check every value.': 'قرأها {provider} ({model}). راجع كل قيمة.',
  'Receive the goods of {order}': 'استلام بضاعة {order}',
  'Choose the supplier…': 'اختر المورد…',
  'VAT on the bill ({currency})': 'ضريبة القيمة المضافة في الفاتورة ({currency})',
  'The bill says': 'في الفاتورة',
  'Received, not billed': 'مستلم ولم يُفوتر',
  'Order price': 'سعر أمر الشراء',
  'Not on the bill': 'غير موجود في الفاتورة',
  'Lines on the bill that are not on the order': 'بنود في الفاتورة غير موجودة في أمر الشراء',
  'Save the bill': 'حفظ الفاتورة',
  'Saving…': 'جارٍ الحفظ…',
  Discard: 'تجاهل',
  'Bill {number} saved. The photo is attached to it.': 'تم حفظ الفاتورة {number} وأُرفقت بها الصورة.',
  'Bill {number} saved, but the photo could not be attached: {reason}': 'تم حفظ الفاتورة {number}، لكن تعذّر إرفاق الصورة: {reason}',
  // warnings from our matching (apps/api/src/modules/purchasing/billMatch.ts)
  'No supplier matches "{name}" (tax number {tax}). Choose the supplier.': 'لا يوجد مورد يطابق «{name}» (الرقم الضريبي {tax}). اختر المورد.',
  'The tax number on the bill ({bill}) is not the one saved for {supplier} ({saved}).':
    'الرقم الضريبي في الفاتورة ({bill}) ليس الرقم المحفوظ للمورد {supplier} ({saved}).',
  'The bill number could not be read. Type it.': 'تعذّرت قراءة رقم الفاتورة. اكتبه.',
  'The bill date could not be read. Check it.': 'تعذّرت قراءة تاريخ الفاتورة. راجعه.',
  'No goods from this supplier are waiting for a bill. Receive the goods first, then scan the bill again.':
    'لا توجد بضاعة مستلمة من هذا المورد تنتظر فاتورة. استلم البضاعة أولًا، ثم امسح الفاتورة مرة أخرى.',
  'The bill is in {bill}; the order is in {order}.': 'الفاتورة بعملة {bill}، وأمر الشراء بعملة {order}.',
  'This line is not on the order.': 'هذا البند غير موجود في أمر الشراء.',
  'The quantity could not be read.': 'تعذّرت قراءة الكمية.',
  'The bill says {bill}, but only {left} were received and not yet billed. The draft uses {left}.':
    'في الفاتورة {bill}، لكن المستلم وغير المفوتر {left} فقط. المسودة تستخدم {left}.',
  'The bill says {bill}; {left} were received and not yet billed.': 'في الفاتورة {bill}؛ والمستلم وغير المفوتر {left}.',
  'Price is not the same as the order: the bill says {bill}, the order says {order} ({diff} for each unit). The bill is saved at the order price: correct the order or ask the supplier for a credit note.':
    'السعر يختلف عن أمر الشراء: في الفاتورة {bill}، وفي أمر الشراء {order} ({diff} لكل وحدة). تُحفظ الفاتورة بسعر أمر الشراء: صحّح أمر الشراء أو اطلب من المورد إشعارًا دائنًا.',
  'VAT is not the same: the bill says {bill}%, the item has {item}%.': 'الضريبة مختلفة: في الفاتورة {bill}%، وللصنف {item}%.',
  '{item}: {left} received and not yet billed, but not on this bill.': '{item}: {left} مستلم ولم يُفوتر، لكنه غير موجود في هذه الفاتورة.',
  'The lines add up to {sum}, but the bill prints {net} before VAT.': 'مجموع البنود {sum}، لكن الفاتورة تطبع {net} قبل الضريبة.',
  'The total before VAT plus VAT ({sum}) is not the printed total ({total}).': 'الإجمالي قبل الضريبة مع الضريبة ({sum}) لا يساوي الإجمالي المطبوع ({total}).',
  // server messages (scanning)
  'The owner must accept the AI notice first (Settings → Integrations).': 'يجب أن يوافق المالك على إشعار الذكاء الاصطناعي أولًا (الإعدادات ← التكاملات).',
  'No AI that reads documents is set up. Add your own key for OpenAI, Gemini, Claude, Grok, OpenRouter or Ollama in Settings → Integrations, and switch it on.':
    'لا يوجد ذكاء اصطناعي مُعدّ لقراءة المستندات. أضف مفتاحك الخاص لـ OpenAI أو Gemini أو Claude أو Grok أو OpenRouter أو Ollama في الإعدادات ← التكاملات، ثم شغّله.',
  'The file must be between 1 byte and 10 MB': 'يجب أن يكون حجم الملف بين 1 بايت و10 ميجابايت',
  'The file must be a JPEG, PNG or WebP picture, or a PDF': 'يجب أن يكون الملف صورة JPEG أو PNG أو WebP، أو ملف PDF',
  'Attachments need a database update (sql/108) first.': 'المرفقات تحتاج تحديثًا لقاعدة البيانات (sql/108) أولًا.',
  'The file store did not accept the file. Try again.': 'لم يقبل مخزن الملفات الملف. حاول مرة أخرى.',
  'This AI provider needs a database update (sql/108) first.': 'مزوّد الذكاء الاصطناعي هذا يحتاج تحديثًا لقاعدة البيانات (sql/108) أولًا.',
  'The new AI notice needs a database update (sql/108) first.': 'إشعار الذكاء الاصطناعي الجديد يحتاج تحديثًا لقاعدة البيانات (sql/108) أولًا.',
  // step 3: attachments
  Attachments: 'المرفقات',
  'File attached.': 'تم إرفاق الملف.',
  'File removed.': 'تمت إزالة الملف.',
  'Uploading…': 'جارٍ الرفع…',
  'Open {name}': 'فتح {name}',
  'the file': 'الملف',
  File: 'ملف',
  Remove: 'إزالة',
  'Yes, remove': 'نعم، أزل',
  'Remove this file from the record? It is kept in the history.': 'إزالة هذا الملف من السجل؟ يبقى محفوظًا في السجل التاريخي.',
  'No files attached yet.': 'لا توجد ملفات مرفقة بعد.',
};
