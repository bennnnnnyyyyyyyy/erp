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
};
