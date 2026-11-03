# Arabic review sheet: screen text

Status: **machine draft, not reviewed by a native speaker.** Written 2026-11-03. Source of truth is `apps/web/src/lib/i18nScreens.ts` (menus: `i18nNav.ts`; shell, tutorial, Guide and tour text: `i18n.tsx`, `helpContent.ts`, `tourContent.ts`).

How to review: edit the **Arabic** column directly in `i18nScreens.ts` (the English text is the key, so do not change the English side). Keep `{placeholders}` and `**bold**` markers unchanged: a test fails if they are lost. Terms are in [arabic-glossary.md](../reference/arabic-glossary.md): change a term there and in the file together.

Known weak spots to look at first:
- Plurals: Arabic has six plural forms; the app only has singular and a general plural (for example "{n} approval" / "{n} approvals"). Counts of 2 and 11 or more may read slightly off.
- Fragments joined to a number or a button (for example "Mark all read (", ") · deliver to", " (overdue)") read correctly only if the word order works around the number.
- Register: written in formal modern standard Arabic. Egyptian users may prefer simpler wording in some places.
- Gender: instructions use the masculine form.

655 entries.

| # | Screen | English | Arabic draft | Reviewed |
|---|--------|---------|--------------|----------|
| 1 | App | Loading… | جارٍ التحميل… | |
| 2 | CreateCompany | Please confirm your email first: open the link we sent you, then come back and sign in. | يرجى تأكيد بريدك الإلكتروني أولًا: افتح الرابط الذي أرسلناه إليك، ثم عُد وسجّل الدخول. | |
| 3 | CreateCompany | You already own three companies. Ask us if you need more. | لديك بالفعل ثلاث شركات. تواصل معنا إذا احتجت إلى المزيد. | |
| 4 | CreateCompany | Please check the company name (at least 2 letters), currency and time zone. | يرجى التحقق من اسم الشركة (حرفان على الأقل) والعملة والمنطقة الزمنية. | |
| 5 | CreateCompany | Please sign in again. | يرجى تسجيل الدخول مرة أخرى. | |
| 6 | CreateCompany | Set up your company | إعداد شركتك | |
| 7 | CreateCompany | Create another company | إنشاء شركة أخرى | |
| 8 | CreateCompany | Takes a minute. You become the owner, and every app is switched on. You can change all of this later in Settings. | تستغرق دقيقة واحدة. ستصبح المالك، وتُفعَّل جميع التطبيقات. يمكنك تغيير كل ذلك لاحقًا من الإعدادات. | |
| 9 | CreateCompany | Company name | اسم الشركة | |
| 10 | CreateCompany | e.g. Nile Cosmetics | مثال: النيل لمستحضرات التجميل | |
| 11 | CreateCompany | Language for the whole company | لغة الشركة بالكامل | |
| 12 | CreateCompany | This is the default language for your company; each person can pick their own under Settings. Arabic is a first draft and covers the menus only so far. | هذه هي اللغة الافتراضية لشركتك، ويمكن لكل شخص اختيار لغته الخاصة من الإعدادات. العربية مسودة أولى وتغطي القوائم فقط حتى الآن. | |
| 13 | CreateCompany | Currency | العملة | |
| 14 | CreateCompany | Time zone | المنطقة الزمنية | |
| 15 | CreateCompany | Setting up… | جارٍ الإعداد… | |
| 16 | CreateCompany | Create my company | إنشاء شركتي | |
| 17 | CreateCompany | Cancel | إلغاء | |
| 18 | EnvBanner | Demo environment: sample data only. Changes are saved to a test database; do not enter real customer data. | بيئة تجريبية: بيانات نموذجية فقط. تُحفظ التغييرات في قاعدة بيانات اختبار؛ لا تُدخل بيانات عملاء حقيقية. | |
| 19 | Modal | Close | إغلاق | |
| 20 | NotificationBell | Notifications, {n} unread | الإشعارات، {n} غير مقروءة | |
| 21 | NotificationBell | Mark all read | تحديد الكل كمقروء | |
| 22 | NotificationBell | Nothing yet. | لا شيء بعد. | |
| 23 | NotificationBell | See all | عرض الكل | |
| 24 | OrgPicker | Loading organizations… | جارٍ تحميل المؤسسات… | |
| 25 | OrgPicker | Invitations | الدعوات | |
| 26 | OrgPicker | {who} invited you to join **{org}** as {role}. | دعاك {who} للانضمام إلى **{org}** بصفة {role}. | |
| 27 | OrgPicker | Someone | شخص ما | |
| 28 | OrgPicker | Accept | قبول | |
| 29 | OrgPicker | Decline | رفض | |
| 30 | OrgPicker | Choose an organization | اختر مؤسسة | |
| 31 | OrgPicker | Accept an invitation above, or set up your own company. | اقبل دعوة أعلاه، أو أنشئ شركتك الخاصة. | |
| 32 | OrgPicker | Create a new company | إنشاء شركة جديدة | |
| 33 | SetPassword | Welcome! Choose a password | مرحبًا! اختر كلمة مرور | |
| 34 | SetPassword | Set a new password | تعيين كلمة مرور جديدة | |
| 35 | SetPassword | New password | كلمة المرور الجديدة | |
| 36 | SetPassword | Confirm new password | تأكيد كلمة المرور الجديدة | |
| 37 | SetPassword | Saving… | جارٍ الحفظ… | |
| 38 | SetPassword | Save password | حفظ كلمة المرور | |
| 39 | SignIn | Sign in | تسجيل الدخول | |
| 40 | SignIn | Create your account | أنشئ حسابك | |
| 41 | SignIn | Reset your password | إعادة تعيين كلمة المرور | |
| 42 | SignIn | We sent a confirmation link to {email}. Open it, then come back here and sign in to set up your company. | أرسلنا رابط تأكيد إلى {email}. افتحه ثم عُد إلى هنا وسجّل الدخول لإعداد شركتك. | |
| 43 | SignIn | Start with your own login. Next you will set up your company, which takes about a minute. | ابدأ بتسجيل دخولك الخاص. بعد ذلك ستُعدّ شركتك، وتستغرق نحو دقيقة. | |
| 44 | SignIn | Supabase isn't configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to the .env at the repo root, then restart the web app. | لم يتم إعداد Supabase. أضف SUPABASE_URL وSUPABASE_PUBLISHABLE_KEY إلى ملف .env في جذر المستودع، ثم أعد تشغيل تطبيق الويب. | |
| 45 | SignIn | Continue with Google | المتابعة باستخدام Google | |
| 46 | SignIn | Email | البريد الإلكتروني | |
| 47 | SignIn | Password | كلمة المرور | |
| 48 | SignIn | At least 8 characters. | 8 أحرف على الأقل. | |
| 49 | SignIn | Repeat the password | أعد كتابة كلمة المرور | |
| 50 | SignIn | Signing in… | جارٍ تسجيل الدخول… | |
| 51 | SignIn | Creating… | جارٍ الإنشاء… | |
| 52 | SignIn | Create account | إنشاء حساب | |
| 53 | SignIn | Sending… | جارٍ الإرسال… | |
| 54 | SignIn | Send reset link | إرسال رابط إعادة التعيين | |
| 55 | SignIn | New here? Create an account | جديد هنا؟ أنشئ حسابًا | |
| 56 | SignIn | Forgot password? | هل نسيت كلمة المرور؟ | |
| 57 | SignIn | Back to sign in | العودة إلى تسجيل الدخول | |
| 58 | ListView | Search… | بحث… | |
| 59 | ListView | Search {title} | بحث في {title} | |
| 60 | ListView | Export CSV | تصدير CSV | |
| 61 | ListView | Actions | الإجراءات | |
| 62 | ListView | Nothing here yet. | لا يوجد شيء هنا بعد. | |
| 63 | ListView | No matches. | لا توجد نتائج مطابقة. | |
| 64 | Alerts | Stock is running low | المخزون يوشك على النفاد | |
| 65 | Alerts | Leave the number empty to use each item's own reorder level. | اترك الرقم فارغًا لاستخدام حد إعادة الطلب الخاص بكل صنف. | |
| 66 | Alerts | units or fewer available | وحدة أو أقل متاحة | |
| 67 | Alerts | A batch is about to expire | دفعة توشك على انتهاء الصلاحية | |
| 68 | Alerts | Also tells you about batches that already expired. | ينبّهك أيضًا إلى الدفعات التي انتهت صلاحيتها بالفعل. | |
| 69 | Alerts | days before expiry | يومًا قبل انتهاء الصلاحية | |
| 70 | Alerts | A customer invoice is late | فاتورة عميل متأخرة | |
| 71 | Alerts | Counted from the invoice date. | تُحسب من تاريخ الفاتورة. | |
| 72 | Alerts | days after the invoice date | يومًا بعد تاريخ الفاتورة | |
| 73 | Alerts | The month is losing money | الشهر يحقق خسارة | |
| 74 | Alerts | Sales minus cost of goods minus expenses, this month so far. | المبيعات مطروحًا منها تكلفة البضاعة والمصروفات، هذا الشهر حتى الآن. | |
| 75 | Alerts | An item will run out soon (forecast) | صنف سينفد قريبًا (توقّع) | |
| 76 | Alerts | Uses the Stock forecast: the message says how many days are left and how reliable the guess is. Items nobody used in 90 days are ignored. | يعتمد على توقعات المخزون: تذكر الرسالة كم يومًا تبقى ومدى موثوقية التقدير. تُتجاهل الأصناف التي لم يستخدمها أحد خلال 90 يومًا. | |
| 77 | Alerts | days of stock left, or fewer | يومًا من المخزون المتبقي أو أقل | |
| 78 | Alerts | All owners | جميع المالكين | |
| 79 | Alerts | All admins | جميع المديرين | |
| 80 | Alerts | All staff | جميع الموظفين | |
| 81 | Alerts | All viewers | جميع المشاهدين | |
| 82 | Alerts | , {n} or fewer | ، {n} أو أقل | |
| 83 | Alerts | , at its reorder level | ، عند حد إعادة الطلب | |
| 84 | Alerts | Team: {name} | الفريق: {name} | |
| 85 | Alerts | Rules tell the right people when something needs attention. They are checked every five minutes, and the same thing is not repeated until the "repeat after" time has passed (unless it gets clearly worse). Alerts arrive as notifications; WhatsApp comes later. | تُبلغ القواعد الأشخاص المناسبين عندما يحتاج أمر ما إلى انتباه. تُفحص كل خمس دقائق، ولا يتكرر التنبيه نفسه إلا بعد انقضاء مدة «التكرار بعد» (ما لم يزدد الوضع سوءًا بوضوح). تصل التنبيهات كإشعارات، وسيأتي واتساب لاحقًا. | |
| 86 | Alerts | Rules | القواعد | |
| 87 | Alerts | What you are told about, and who is told. Each rule is checked every five minutes against the current stock, batches and invoices. | ما يُبلَّغ به الأشخاص ومن يُبلَّغ. تُفحص كل قاعدة كل خمس دقائق مقابل المخزون والدفعات والفواتير الحالية. | |
| 88 | Alerts | Rule | القاعدة | |
| 89 | Alerts | When | متى | |
| 90 | Alerts | Who is told | من يُبلَّغ | |
| 91 | Alerts | Repeat after | التكرار بعد | |
| 92 | Alerts | Fired | مرات التنبيه | |
| 93 | Alerts | State | الحالة | |
| 94 | Alerts | · last | · آخرها | |
| 95 | Alerts | On | مفعّلة | |
| 96 | Alerts | Off | متوقفة | |
| 97 | Alerts | Turn off | إيقاف | |
| 98 | Alerts | Turn on | تفعيل | |
| 99 | Alerts | Send me a test | أرسل لي رسالة اختبار | |
| 100 | Alerts | {name} removed (kept in the history). | أُزيلت {name} (محفوظة في السجل). | |
| 101 | Alerts | Remove | إزالة | |
| 102 | Alerts | No rules yet. Add one below. | لا توجد قواعد بعد. أضف قاعدة أدناه. | |
| 103 | Alerts | Add a rule | إضافة قاعدة | |
| 104 | Alerts | Name | الاسم | |
| 105 | Alerts | e.g. Glycerin running low | مثال: الجلسرين يوشك على النفاد | |
| 106 | Alerts | Tell me when | أبلغني عندما | |
| 107 | Alerts | For | بخصوص | |
| 108 | Alerts | Every item | كل صنف | |
| 109 | Alerts | Number | الرقم | |
| 110 | Alerts | Number (optional) | الرقم (اختياري) | |
| 111 | Alerts | Choose… | اختر… | |
| 112 | Alerts | Repeat after (hours) | التكرار بعد (ساعات) | |
| 113 | Alerts | Rule "{name}" added. | أُضيفت القاعدة «{name}». | |
| 114 | Alerts | Add rule | إضافة القاعدة | |
| 115 | Alerts | Teams | الفرق | |
| 116 | Alerts | A team is a named group (Purchasing, Warehouse, Management) so a rule can say "tell Purchasing". Whoever buys stock belongs in Purchasing. | الفريق مجموعة مسمّاة (المشتريات، المستودع، الإدارة) لكي تستطيع القاعدة أن تقول «أبلغ المشتريات». من يشتري المخزون ينتمي إلى فريق المشتريات. | |
| 117 | Alerts | Create the standard teams | إنشاء الفرق القياسية | |
| 118 | Alerts | {name} updated. | تم تحديث {name}. | |
| 119 | Alerts | New team | فريق جديد | |
| 120 | Alerts | e.g. Quality | مثال: الجودة | |
| 121 | Alerts | Team "{name}" added. | أُضيف الفريق «{name}». | |
| 122 | Alerts | Add team | إضافة فريق | |
| 123 | Home | No business apps are switched on yet. | لم يتم تفعيل أي تطبيقات عمل بعد. | |
| 124 | Home | Switch on Inventory | فعّل المخزون | |
| 125 | Home | to start managing stock. | لتبدأ إدارة المخزون. | |
| 126 | OwnerHome | All good | كل شيء على ما يرام | |
| 127 | OwnerHome | Keep an eye on this | يستحق المتابعة | |
| 128 | OwnerHome | Needs action | يحتاج إلى إجراء | |
| 129 | OwnerHome | Could not load the summary: | تعذّر تحميل الملخص: | |
| 130 | OwnerHome | Loading the summary… | جارٍ تحميل الملخص… | |
| 131 | OwnerHome | Business summary | ملخص الأعمال | |
| 132 | OwnerHome | Am I making or losing money? | هل أربح أم أخسر؟ | |
| 133 | OwnerHome | What the business earned after its costs | ما حققته الشركة بعد خصم تكاليفها | |
| 134 | OwnerHome | {month}, and the last 12 months | {month}، وآخر 12 شهرًا | |
| 135 | OwnerHome | last 12 months | آخر 12 شهرًا | |
| 136 | OwnerHome | Lost {amount} | خسارة {amount} | |
| 137 | OwnerHome | Made {amount} | ربح {amount} | |
| 138 | OwnerHome | in {month}: sales {revenue}, cost of what you sold {cogs}, running costs {expenses}. | في {month}: المبيعات {revenue}، تكلفة ما بعته {cogs}، تكاليف التشغيل {expenses}. | |
| 139 | OwnerHome | No sales recorded yet. | لم تُسجَّل مبيعات بعد. | |
| 140 | OwnerHome | Last 12 months: lost {amount} in total. | آخر 12 شهرًا: خسارة {amount} إجمالًا. | |
| 141 | OwnerHome | Last 12 months: made {amount} in total. | آخر 12 شهرًا: ربح {amount} إجمالًا. | |
| 142 | OwnerHome | This month so far: down {amount}. | هذا الشهر حتى الآن: خسارة {amount}. | |
| 143 | OwnerHome | This month so far: up {amount}. | هذا الشهر حتى الآن: ربح {amount}. | |
| 144 | OwnerHome | This month so far: nothing recorded yet. | هذا الشهر حتى الآن: لا شيء مسجّل بعد. | |
| 145 | OwnerHome | Money coming in and going out | الأموال الداخلة والخارجة | |
| 146 | OwnerHome | Who owes you and who you owe | من يدين لك ومن تدين له | |
| 147 | OwnerHome | all unpaid bills, as of {date} | جميع الفواتير غير المسددة حتى {date} | |
| 148 | OwnerHome | customers still owe you, of which **{late}** is more than 30 days late. | عملاؤك ما زالوا مدينين لك، منها **{late}** متأخرة أكثر من 30 يومًا. | |
| 149 | OwnerHome | customers still owe you. | عملاؤك ما زالوا مدينين لك. | |
| 150 | OwnerHome | You owe suppliers and for expenses: **{amount}**. | أنت مدين للموردين وللمصروفات بمبلغ **{amount}**. | |
| 151 | OwnerHome | Waiting for your decision | بانتظار قرارك | |
| 152 | OwnerHome | Stock requests a manager still has to approve | طلبات مخزون ما زال على مدير اعتمادها | |
| 153 | OwnerHome | right now, {date} | الآن، {date} | |
| 154 | OwnerHome | {n} request | {n} طلب | |
| 155 | OwnerHome | {n} requests | {n} طلبات | |
| 156 | OwnerHome | Nothing is waiting for approval. | لا شيء بانتظار الموافقة. | |
| 157 | OwnerHome | The oldest has been waiting less than an hour. | أقدمها ينتظر منذ أقل من ساعة. | |
| 158 | OwnerHome | The oldest has been waiting 1 hour. | أقدمها ينتظر منذ ساعة واحدة. | |
| 159 | OwnerHome | The oldest has been waiting {n} hours. | أقدمها ينتظر منذ {n} ساعات. | |
| 160 | OwnerHome | {n} approved and waiting to be handed out. | {n} معتمد وبانتظار التسليم. | |
| 161 | OwnerHome | Stock and expiry | المخزون والصلاحية | |
| 162 | OwnerHome | What is on the shelves and what is about to expire | ما هو موجود على الأرفف وما يوشك على الانتهاء | |
| 163 | OwnerHome | as of {date}, looking 90 days ahead | حتى {date}، بنظرة 90 يومًا قادمة | |
| 164 | OwnerHome | of stock on the shelves, at cost. | قيمة المخزون على الأرفف بسعر التكلفة. | |
| 165 | OwnerHome | batch(es) already expired ({value}) | دفعة (دفعات) انتهت صلاحيتها بالفعل ({value}) | |
| 166 | OwnerHome | **{a}** expire within 30 days ({value}), **{b}** within 60, **{c}** within 90 | **{a}** تنتهي صلاحيتها خلال 30 يومًا ({value})، و**{b}** خلال 60 يومًا، و**{c}** خلال 90 يومًا | |
| 167 | OwnerHome | item(s) at or below their reorder level | صنف (أصناف) عند حد إعادة الطلب أو أقل منه | |
| 168 | OwnerHome | Best sellers | الأكثر مبيعًا | |
| 169 | OwnerHome | The products that brought in the most sales | المنتجات التي حققت أعلى مبيعات | |
| 170 | OwnerHome | last 90 days | آخر 90 يومًا | |
| 171 | OwnerHome | No sales yet. | لا مبيعات بعد. | |
| 172 | OwnerHome | Who you depend on | من تعتمد عليهم | |
| 173 | OwnerHome | The suppliers most of your purchases come from | الموردون الذين تأتي منهم معظم مشترياتك | |
| 174 | OwnerHome | {pct}% of purchases | {pct}% من المشتريات | |
| 175 | OwnerHome | No purchases yet. | لا مشتريات بعد. | |
| 176 | OwnerHome | item(s) bought from only one supplier in the last year. | صنف (أصناف) اشتُريت من مورد واحد فقط خلال العام الماضي. | |
| 177 | OwnerHome | As of {datetime}. A management view: no VAT, cost of goods is the average cost of the stock, overdue means unpaid after 30 days. Not a statutory accounts report. | حتى {datetime}. هذه نظرة إدارية: بدون ضريبة القيمة المضافة، وتكلفة البضاعة هي متوسط تكلفة المخزون، والمتأخر يعني غير مسدد بعد 30 يومًا. وهي ليست تقرير حسابات قانونيًا. | |
| 178 | AppsSettings | Switch off {name}? Its data is kept, but nobody can open it until it's switched back on. | هل تريد إيقاف {name}؟ تبقى بياناته محفوظة، لكن لا يستطيع أحد فتحه حتى يُعاد تشغيله. | |
| 179 | AppsSettings | Choose which apps {org} uses. Switching one off hides it but keeps its data. | اختر التطبيقات التي تستخدمها {org}. إيقاف أحدها يخفيه لكنه يحتفظ ببياناته. | |
| 180 | AppsSettings | Always on | مفعّل دائمًا | |
| 181 | AppsSettings | Working… | جارٍ التنفيذ… | |
| 182 | AppsSettings | Switch off | إيقاف | |
| 183 | AppsSettings | Switch on | تشغيل | |
| 184 | AuditLog | Who | من | |
| 185 | AuditLog | Action | الإجراء | |
| 186 | AuditLog | Details | التفاصيل | |
| 187 | AuditLog | Every change made in {org}, newest first. Entries can't be edited or deleted. | كل تغيير أُجري في {org}، الأحدث أولًا. لا يمكن تعديل السجلات أو حذفها. | |
| 188 | AuditLog | No activity yet. | لا نشاط بعد. | |
| 189 | GeneralSettings | How your organization appears and the defaults every app uses. | كيف تظهر مؤسستك والإعدادات الافتراضية التي يستخدمها كل تطبيق. | |
| 190 | GeneralSettings | English | English | |
| 191 | GeneralSettings | Only for you, on this account. Nothing is forced: pick a language, or follow the company default. Arabic is a machine draft covering {n} menu strings, the home page and most screens so far; it must be reviewed by a native speaker before customers rely on it. | لك أنت فقط، على هذا الحساب. لا شيء مفروض: اختر لغة أو اتبع الافتراضية للشركة. العربية مسودة آلية تغطي {n} نصًا من القوائم والصفحة الرئيسية ومعظم الشاشات حتى الآن، ويجب أن يراجعها متحدث أصلي قبل أن يعتمد عليها العملاء. | |
| 192 | GeneralSettings | Organization name | اسم المؤسسة | |
| 193 | GeneralSettings | Default currency | العملة الافتراضية | |
| 194 | GeneralSettings | Date format | صيغة التاريخ | |
| 195 | GeneralSettings | Default language for the company | اللغة الافتراضية للشركة | |
| 196 | GeneralSettings | The language people see until they choose their own under "My language" above. It is chosen when the company signs up and can be changed here. Arabic is a machine draft covering the menus only so far; a native speaker must review it before customers see it. | اللغة التي يراها الأشخاص إلى أن يختاروا لغتهم تحت «لغتي» أعلاه. تُختار عند تسجيل الشركة ويمكن تغييرها هنا. العربية مسودة آلية تغطي القوائم فقط حتى الآن؛ ويجب أن يراجعها متحدث أصلي قبل أن يراها العملاء. | |
| 197 | GeneralSettings | Dates and times across the app are shown in this zone. | تُعرض التواريخ والأوقات في التطبيق كله بهذه المنطقة الزمنية. | |
| 198 | GeneralSettings | Save changes | حفظ التغييرات | |
| 199 | GeneralSettings | Discard | تجاهل | |
| 200 | GeneralSettings | Only owners and admins can change these settings. | يمكن للمالكين والمديرين فقط تغيير هذه الإعدادات. | |
| 201 | GeneralSettings | Getting-started guide | دليل البدء | |
| 202 | GeneralSettings | A short tutorial for new companies, shown as the "Getting started" app. It is on for this company. | دليل تعليمي قصير للشركات الجديدة، يظهر كتطبيق «البدء». وهو مفعّل لهذه الشركة. | |
| 203 | GeneralSettings | A short tutorial for new companies, shown as the "Getting started" app. It is off for this company. | دليل تعليمي قصير للشركات الجديدة، يظهر كتطبيق «البدء». وهو متوقف لهذه الشركة. | |
| 204 | GeneralSettings | Hide the guide | إخفاء الدليل | |
| 205 | GeneralSettings | Show the guide | إظهار الدليل | |
| 206 | GeneralSettings | Guided tour | الجولة الإرشادية | |
| 207 | GeneralSettings | A step-by-step tour that walks people through the real screens, in English or Arabic. It is on for this company: a "Take the tour" button appears on the Guide and Getting-started pages. | جولة خطوة بخطوة تأخذ الأشخاص عبر الشاشات الحقيقية، بالإنجليزية أو العربية. وهي مفعّلة لهذه الشركة: يظهر زر «ابدأ الجولة» في صفحتي الدليل والبدء. | |
| 208 | GeneralSettings | A step-by-step tour that walks people through the real screens, in English or Arabic. It is off for this company; when it is on, a "Take the tour" button appears on the Guide and Getting-started pages. | جولة خطوة بخطوة تأخذ الأشخاص عبر الشاشات الحقيقية، بالإنجليزية أو العربية. وهي متوقفة لهذه الشركة؛ وعند تفعيلها يظهر زر «ابدأ الجولة» في صفحتي الدليل والبدء. | |
| 209 | GeneralSettings | Switch the tour off | إيقاف الجولة | |
| 210 | GeneralSettings | Switch the tour on | تفعيل الجولة | |
| 211 | UsersSettings | Everything, including managing owners | كل شيء، بما في ذلك إدارة المالكين | |
| 212 | UsersSettings | Everything except managing owners | كل شيء ما عدا إدارة المالكين | |
| 213 | UsersSettings | Use the apps; no settings or user changes | استخدام التطبيقات؛ دون تغيير الإعدادات أو المستخدمين | |
| 214 | UsersSettings | Read only | للقراءة فقط | |
| 215 | UsersSettings | Send this link to | أرسل هذا الرابط إلى | |
| 216 | UsersSettings | It lets them set a password and sign in. It works once and expires; you can make a new one from the list. Treat it like a password: send it only to them. | يتيح لهم تعيين كلمة مرور وتسجيل الدخول. يعمل مرة واحدة وينتهي؛ ويمكنك إنشاء رابط جديد من القائمة. تعامل معه كما تتعامل مع كلمة المرور: أرسله إليهم وحدهم. | |
| 217 | UsersSettings | Invite link | رابط الدعوة | |
| 218 | UsersSettings | Copied | تم النسخ | |
| 219 | UsersSettings | Copy | نسخ | |
| 220 | UsersSettings | Done | تم | |
| 221 | UsersSettings | Invite someone | دعوة شخص | |
| 222 | UsersSettings | Role | الدور | |
| 223 | UsersSettings | Inviting… | جارٍ الدعوة… | |
| 224 | UsersSettings | Invite | دعوة | |
| 225 | UsersSettings | Disable {email}? They will lose access to {org}. | هل تريد تعطيل {email}؟ سيفقد الوصول إلى {org}. | |
| 226 | UsersSettings | User | المستخدم | |
| 227 | UsersSettings | You | أنت | |
| 228 | UsersSettings | Role for {email} | دور {email} | |
| 229 | UsersSettings | Status | الحالة | |
| 230 | UsersSettings | Added | تاريخ الإضافة | |
| 231 | UsersSettings | Last sign-in | آخر تسجيل دخول | |
| 232 | UsersSettings | Never | أبدًا | |
| 233 | UsersSettings | Who can sign in to {org}, and what they can do. | من يستطيع تسجيل الدخول إلى {org} وما يستطيعون فعله. | |
| 234 | UsersSettings | {email} has been invited. They will see the invitation when they sign in and join once they accept it. | تمت دعوة {email}. ستظهر له الدعوة عند تسجيل دخوله وينضم بمجرد قبولها. | |
| 235 | UsersSettings | Waiting to accept | بانتظار القبول | |
| 236 | UsersSettings | Withdraw | سحب الدعوة | |
| 237 | UsersSettings | Invite user | دعوة مستخدم | |
| 238 | UsersSettings | Cancel invite | إلغاء الدعوة | |
| 239 | UsersSettings | New invite link | رابط دعوة جديد | |
| 240 | UsersSettings | Enable | تفعيل | |
| 241 | UsersSettings | Disable | تعطيل | |
| 242 | Finance | cash | نقدًا | |
| 243 | Finance | bank | تحويل بنكي | |
| 244 | Finance | card | بطاقة | |
| 245 | Finance | cheque | شيك | |
| 246 | Finance | other | أخرى | |
| 247 | Finance | Rent, salaries, utilities, transport: the costs of running the business that are not stock. They are taken off sales to show profit. | الإيجار والرواتب والمرافق والنقل: تكاليف تشغيل الأعمال التي ليست مخزونًا. تُخصم من المبيعات لإظهار الربح. | |
| 248 | Finance | Record an expense | تسجيل مصروف | |
| 249 | Finance | Date | التاريخ | |
| 250 | Finance | Category | الفئة | |
| 251 | Finance | Amount | المبلغ | |
| 252 | Finance | Supplier (optional) | المورّد (اختياري) | |
| 253 | Finance | None | لا شيء | |
| 254 | Finance | Note (optional) | ملاحظة (اختيارية) | |
| 255 | Finance | Expense {number} recorded. | تم تسجيل المصروف {number}. | |
| 256 | Finance | Record expense | تسجيل المصروف | |
| 257 | Finance | New category | فئة جديدة | |
| 258 | Finance | e.g. Rent | مثال: الإيجار | |
| 259 | Finance | Category "{name}" added. | أُضيفت الفئة «{name}». | |
| 260 | Finance | Add category | إضافة فئة | |
| 261 | Finance | Recorded expenses | المصروفات المسجّلة | |
| 262 | Finance | (total {amount}) | (الإجمالي {amount}) | |
| 263 | Finance | Supplier | المورّد | |
| 264 | Finance | Note | ملاحظة | |
| 265 | Finance | Void | إبطال | |
| 266 | Finance | Recorded | سُجّل في | |
| 267 | Finance | {number} voided. | أُبطل {number}. | |
| 268 | Finance | No expenses yet. | لا مصروفات بعد. | |
| 269 | Finance | Supplier invoice {number} | فاتورة المورّد {number} | |
| 270 | Finance | Expense {number} | المصروف {number} | |
| 271 | Finance | Money received from customers and money paid to suppliers and for expenses. A payment can never be more than what is still owed. | الأموال المستلمة من العملاء والمدفوعة للموردين وللمصروفات. لا يمكن أن يزيد المبلغ المدفوع عمّا ما زال مستحقًا. | |
| 272 | Finance | Record a payment | تسجيل عملية دفع | |
| 273 | Finance | Direction | الاتجاه | |
| 274 | Finance | Money received from a customer | أموال مستلمة من عميل | |
| 275 | Finance | Money paid out | أموال مدفوعة | |
| 276 | Finance | · owed | · مستحق | |
| 277 | Finance | Method | الطريقة | |
| 278 | Finance | Payment {number} recorded. | تم تسجيل عملية الدفع {number}. | |
| 279 | Finance | Record payment | تسجيل الدفع | |
| 280 | Finance | More than the {amount} still owed. | أكثر من {amount} المستحقة. | |
| 281 | Finance | Received | مستلم | |
| 282 | Finance | Paid | مدفوع | |
| 283 | Finance | No payments yet. | لا مدفوعات بعد. | |
| 284 | ProfitOverview | Sales against what it cost to make and run the business, month by month. Cost of goods is the average cost of the stock that was sold; running costs are the expenses you recorded. No VAT. Not an accounts report. | المبيعات مقابل ما يكلّفه إنتاج العمل وتشغيله، شهرًا بشهر. تكلفة البضاعة هي متوسط تكلفة المخزون الذي بيع؛ وتكاليف التشغيل هي المصروفات التي سجلتها. بدون ضريبة القيمة المضافة. وهو ليس تقرير حسابات. | |
| 285 | ProfitOverview | Result, last 12 months | النتيجة، آخر 12 شهرًا | |
| 286 | ProfitOverview | {pct}% of sales | {pct}% من المبيعات | |
| 287 | ProfitOverview | Sales, last 12 months | المبيعات، آخر 12 شهرًا | |
| 288 | ProfitOverview | invoiced to customers | مفوترة للعملاء | |
| 289 | ProfitOverview | Costs, last 12 months | التكاليف، آخر 12 شهرًا | |
| 290 | ProfitOverview | {cogs} of goods sold + {expenses} running costs | {cogs} تكلفة بضاعة مباعة + {expenses} تكاليف تشغيل | |
| 291 | ProfitOverview | Months in the red, last 12 months | أشهر الخسارة، آخر 12 شهرًا | |
| 292 | ProfitOverview | Best {best}, weakest {worst} | الأفضل {best}، والأضعف {worst} | |
| 293 | ProfitOverview | Sales vs costs, every month | المبيعات مقابل التكاليف، كل شهر | |
| 294 | ProfitOverview | (last 12 months) | (آخر 12 شهرًا) | |
| 295 | ProfitOverview | Costs | التكاليف | |
| 296 | ProfitOverview | Sales and costs per month for the last 12 months | المبيعات والتكاليف شهريًا خلال آخر 12 شهرًا | |
| 297 | ProfitOverview | {month}: sales {sales}, costs {costs}, result {result} | {month}: المبيعات {sales}، التكاليف {costs}، النتيجة {result} | |
| 298 | ProfitOverview | The dot under each month is green when you made money that month and red when you lost money. Hover a month for its figures. | تكون النقطة تحت كل شهر خضراء إذا ربحت فيه وحمراء إذا خسرت. مرّر المؤشر فوق شهر لترى أرقامه. | |
| 299 | ProfitOverview | Month by month | شهرًا بشهر | |
| 300 | ProfitOverview | Month | الشهر | |
| 301 | ProfitOverview | Cost of goods | تكلفة البضاعة | |
| 302 | ProfitOverview | Running costs | تكاليف التشغيل | |
| 303 | ProfitOverview | Result | النتيجة | |
| 304 | ProfitOverview | Margin | الهامش | |
| 305 | ProfitOverview | nothing recorded | لا شيء مسجّل | |
| 306 | ProfitOverview | Last 12 months | آخر 12 شهرًا | |
| 307 | ProfitOverview | As of {datetime}. The current month is incomplete until it ends. | حتى {datetime}. الشهر الحالي غير مكتمل حتى ينتهي. | |
| 308 | GettingStarted | Open it | فتح | |
| 309 | Batches | Expired | منتهية الصلاحية | |
| 310 | Batches | Within 30 days | خلال 30 يومًا | |
| 311 | Batches | Within 60 days | خلال 60 يومًا | |
| 312 | Batches | Within 90 days | خلال 90 يومًا | |
| 313 | Batches | Stock that expires is kept in batches. The system always issues the batch that expires first, and never issues a quarantined or expired batch. Owners and admins switch batch tracking on per item at the bottom of this page. | يُحفظ المخزون الذي تنتهي صلاحيته في دفعات. يصرف النظام دائمًا الدفعة الأقرب انتهاءً، ولا يصرف أبدًا دفعة محجورة أو منتهية الصلاحية. يفعّل المالكون والمديرون تتبع الدفعات لكل صنف في أسفل هذه الصفحة. | |
| 314 | Batches | Expiring in the next 90 days | تنتهي صلاحيتها خلال الـ 90 يومًا القادمة | |
| 315 | Batches | Item | الصنف | |
| 316 | Batches | Batch | الدفعة | |
| 317 | Batches | Quantity | الكمية | |
| 318 | Batches | Expires | تنتهي الصلاحية | |
| 319 | Batches | Expired {n} days ago | انتهت منذ {n} يومًا | |
| 320 | Batches | {n} days left | متبقٍ {n} يومًا | |
| 321 | Batches | Quarantined | محجورة | |
| 322 | Batches | Nothing expires in the next 90 days. | لا شيء تنتهي صلاحيته خلال الـ 90 يومًا القادمة. | |
| 323 | Batches | Receive a batch | استلام دفعة | |
| 324 | Batches | Batch number | رقم الدفعة | |
| 325 | Batches | Made on (optional) | تاريخ الإنتاج (اختياري) | |
| 326 | Batches | Expires on | تنتهي الصلاحية في | |
| 327 | Batches | Batch {no} received. | تم استلام الدفعة {no}. | |
| 328 | Batches | Receive batch | استلام الدفعة | |
| 329 | Batches | All batches | كل الدفعات | |
| 330 | Batches | Made | تاريخ الإنتاج | |
| 331 | Batches | Stock | المخزون | |
| 332 | Batches | Available | متاحة | |
| 333 | Batches | Batch {no} is now {status}. | أصبحت الدفعة {no} {status}. | |
| 334 | Batches | Release | إفراج | |
| 335 | Batches | Quarantine | حجر | |
| 336 | Batches | No batches yet. | لا دفعات بعد. | |
| 337 | Batches | Storage conditions | ظروف التخزين | |
| 338 | Batches | Name the places stock must be kept (for example Cold room 2 to 8 °C). An item with a condition cannot be received into a warehouse with a different one. | سمِّ الأماكن التي يجب حفظ المخزون فيها (مثل غرفة التبريد من 2 إلى 8 °م). لا يمكن استلام صنف له ظرف تخزين في مستودع بظرف مختلف. | |
| 339 | Batches | None yet. | لا شيء بعد. | |
| 340 | Batches | From °C | من °م | |
| 341 | Batches | To °C | إلى °م | |
| 342 | Batches | Condition "{name}" added. | أُضيف الظرف «{name}». | |
| 343 | Batches | Add condition | إضافة ظرف | |
| 344 | Batches | Batch tracking per item | تتبع الدفعات لكل صنف | |
| 345 | Batches | Switch on for items that expire (creams, oils, actives). Existing stock moves into an "UNBATCHED" lot that is issued last. Choose where the item must be kept. | فعّله للأصناف التي تنتهي صلاحيتها (الكريمات والزيوت والمواد الفعّالة). ينتقل المخزون الحالي إلى حصة باسم «UNBATCHED» تُصرف أخيرًا. اختر المكان الذي يجب حفظ الصنف فيه. | |
| 346 | Batches | Tracking | التتبع | |
| 347 | Batches | Must be stored | مكان التخزين المطلوب | |
| 348 | Batches | Storage for {sku} saved. | تم حفظ تخزين {sku}. | |
| 349 | Batches | Anywhere | أي مكان | |
| 350 | Batches | {sku}: batch tracking off. | {sku}: تتبع الدفعات متوقف. | |
| 351 | Batches | {sku}: batch tracking on. | {sku}: تتبع الدفعات مفعّل. | |
| 352 | Forecast | When each item will run out, worked out from what your own warehouse issued in the last 90 days (the latest month counts most). A date based on thin history is a guess: look at the "How sure" column. | متى سينفد كل صنف، بحسب ما صرفه مستودعك في آخر 90 يومًا (الشهر الأحدث له الوزن الأكبر). أي تاريخ مبني على سجل قليل هو تخمين: انظر عمود «مدى التأكد». | |
| 353 | Forecast | Running out within 14 days | ينفد خلال 14 يومًا | |
| 354 | Forecast | Worth ordering now | يستحق الطلب الآن | |
| 355 | Forecast | Items with a forecast | الأصناف التي لها توقّع | |
| 356 | Forecast | Used per day | المستخدم يوميًا | |
| 357 | Forecast | Runs out | ينفد في | |
| 358 | Forecast | How sure | مدى التأكد | |
| 359 | Forecast | Supplier takes | مدة توريد المورّد | |
| 360 | Forecast | Already ordered | مطلوب مسبقًا | |
| 361 | Forecast | Order now | اطلب الآن | |
| 362 | Forecast | {n} days | {n} يومًا | |
| 363 | Forecast | no use in 90 days | لا استخدام في 90 يومًا | |
| 364 | Forecast | Solid history | سجل موثوق | |
| 365 | Forecast | {issues} issue(s) over {days} days | {issues} عملية صرف خلال {days} يومًا | |
| 366 | Forecast | Thin: a guess | سجل قليل: تخمين | |
| 367 | Forecast | No items yet. | لا أصناف بعد. | |
| 368 | Forecast | How it is worked out: usage per day = 50% of the latest 30 days + 30% of the 30 before + 20% of the 30 before that. Days left = available stock (on hand minus reserved) divided by usage per day. Order now = usage per day x (supplier lead time + 7 safety days) minus available minus what is already on order. The supplier time is the average of your own past purchases (7 days if the item was never bought). Seasonal swings are not modelled yet. To be told automatically, add an | طريقة الحساب: الاستخدام اليومي = 50% من آخر 30 يومًا + 30% من الـ 30 التي قبلها + 20% من الـ 30 التي قبلها. الأيام المتبقية = المخزون المتاح (الموجود مطروحًا منه المحجوز) مقسومًا على الاستخدام اليومي. الكمية المطلوب طلبها الآن = الاستخدام اليومي × (مدة توريد المورّد + 7 أيام أمان) مطروحًا منها المتاح وما هو مطلوب فعلًا. مدة المورّد هي متوسط مشترياتك السابقة (7 أيام إن لم يُشترَ الصنف قط). لا تُراعى التقلبات الموسمية بعد. لتُنبَّه تلقائيًا، أضف | |
| 369 | Forecast | alert rule | قاعدة تنبيه | |
| 370 | Inventory | Waiting for approval | بانتظار الموافقة | |
| 371 | Inventory | Approved | تمت الموافقة | |
| 372 | Inventory | Rejected | مرفوض | |
| 373 | Inventory | Issued | تم الصرف | |
| 374 | Inventory | Cancelled | ملغى | |
| 375 | Inventory | Request progress | سير الطلب | |
| 376 | Inventory | Add item | إضافة صنف | |
| 377 | Inventory | Unit | الوحدة | |
| 378 | Inventory | Name in Arabic | الاسم بالعربية | |
| 379 | Inventory | Opening stock | المخزون الافتتاحي | |
| 380 | Inventory | Add warehouse | إضافة مستودع | |
| 381 | Inventory | A warehouse is any place you keep stock: a store room, a cold room, a shelf area. Items are received into one. | المستودع هو أي مكان تحفظ فيه المخزون: مخزن أو غرفة تبريد أو منطقة أرفف. تُستلم الأصناف في أحدها. | |
| 382 | Inventory | Short code | رمز قصير | |
| 383 | Inventory | Main warehouse | المستودع الرئيسي | |
| 384 | Inventory | Name in Arabic (optional) | الاسم بالعربية (اختياري) | |
| 385 | Inventory | Arabic name | الاسم العربي | |
| 386 | Inventory | Stock level | مستوى المخزون | |
| 387 | Inventory | {available} available, {reserved} reserved, {onHand} on hand | {available} متاح، {reserved} محجوز، {onHand} موجود | |
| 388 | Inventory | On hand | الموجود | |
| 389 | Inventory | Reserved | محجوز | |
| 390 | Inventory | Reserved stock is promised to a request that is waiting for approval or not yet issued. Available = on hand minus reserved. | المخزون المحجوز موعود به لطلب ينتظر الموافقة أو لم يُصرف بعد. المتاح = الموجود ناقص المحجوز. | |
| 391 | Inventory | Items | الأصناف | |
| 392 | Inventory | {n} warehouses | {n} مستودعات | |
| 393 | Inventory | Units on hand | وحدات موجودة | |
| 394 | Inventory | held for open requests | محجوزة للطلبات المفتوحة | |
| 395 | Inventory | a manager needs to decide | يجب أن يقرر مدير | |
| 396 | Inventory | nothing pending | لا شيء معلّق | |
| 397 | Inventory | All warehouses | كل المستودعات | |
| 398 | Inventory | Start by adding your first warehouse (any place you keep stock), then add items to it. | ابدأ بإضافة أول مستودع (أي مكان تحفظ فيه المخزون)، ثم أضف إليه الأصناف. | |
| 399 | Inventory | No warehouse exists yet. Ask an owner or admin to add one. | لا يوجد مستودع بعد. اطلب من المالك أو المسؤول إضافة مستودع. | |
| 400 | Inventory | {sku} reorder level saved. | تم حفظ حد إعادة الطلب للصنف {sku}. | |
| 401 | Inventory | Set the minimum available stock for each item. Managers receive one low-stock notification per item per day when available stock reaches the level. | حدد الحد الأدنى للمخزون المتاح لكل صنف. يتلقى المديرون إشعارًا واحدًا بانخفاض المخزون لكل صنف في اليوم عندما يبلغ المتاح هذا الحد. | |
| 402 | Inventory | Reorder level | حد إعادة الطلب | |
| 403 | Inventory | Reorder level for {sku} | حد إعادة الطلب للصنف {sku} | |
| 404 | Inventory | Not monitored | غير مراقَب | |
| 405 | Inventory | Low stock | مخزون منخفض | |
| 406 | Inventory | Healthy | سليم | |
| 407 | Inventory | Save | حفظ | |
| 408 | Inventory | Only owners and admins can change reorder levels. | يمكن للمالكين والمسؤولين فقط تغيير حدود إعادة الطلب. | |
| 409 | Inventory | Set when a stock request needs more than one manager. The highest matching rule applies; requests below all thresholds need one approval. | يُضبط عندما يحتاج طلب مخزون إلى أكثر من مدير. تنطبق أعلى قاعدة مطابقة؛ والطلبات الأقل من كل الحدود تحتاج موافقة واحدة. | |
| 410 | Inventory | Add or update a policy | إضافة سياسة أو تحديثها | |
| 411 | Inventory | From total quantity | من إجمالي كمية | |
| 412 | Inventory | Required approvals | الموافقات المطلوبة | |
| 413 | Inventory | 1 approval | موافقة واحدة | |
| 414 | Inventory | 2 approvals | موافقتان | |
| 415 | Inventory | 3 approvals | 3 موافقات | |
| 416 | Inventory | Save policy | حفظ السياسة | |
| 417 | Inventory | Threshold | الحد | |
| 418 | Inventory | Required | المطلوب | |
| 419 | Inventory | units or more | وحدات أو أكثر | |
| 420 | Inventory | {n} approval | {n} موافقة | |
| 421 | Inventory | {n} approvals | {n} موافقات | |
| 422 | Inventory | No extra approval policies. One approval is enough for every request. | لا سياسات موافقة إضافية. موافقة واحدة تكفي لكل طلب. | |
| 423 | Inventory | Only owners and admins can change approval policies. | يمكن للمالكين والمسؤولين فقط تغيير سياسات الموافقة. | |
| 424 | Inventory | Applied | مطبّق | |
| 425 | Inventory | Count stock in a warehouse. A manager must approve the difference before it reaches the stock ledger. | عدّ المخزون في مستودع. يجب أن يوافق مدير على الفرق قبل أن يصل إلى دفتر المخزون. | |
| 426 | Inventory | New cycle count | جرد دوري جديد | |
| 427 | Inventory | Choose an item… | اختر صنفًا… | |
| 428 | Inventory | Choose a warehouse… | اختر مستودعًا… | |
| 429 | Inventory | Counted quantity | الكمية المعدودة | |
| 430 | Inventory | Book quantity: | الكمية الدفترية: | |
| 431 | Inventory | Reason | السبب | |
| 432 | Inventory | Physical count, damaged stock… | جرد فعلي، مخزون تالف… | |
| 433 | Inventory | Submitting… | جارٍ الإرسال… | |
| 434 | Inventory | Submit count | إرسال الجرد | |
| 435 | Inventory | Count | الجرد | |
| 436 | Inventory | Book | الدفتر | |
| 437 | Inventory | Counted | المعدود | |
| 438 | Inventory | Difference | الفرق | |
| 439 | Inventory | Approve | موافقة | |
| 440 | Inventory | Reject | رفض | |
| 441 | Inventory | No stock counts yet. | لا عمليات جرد بعد. | |
| 442 | Inventory | Requested by | بطلب من | |
| 443 | Inventory | Requested | تاريخ الطلب | |
| 444 | Inventory | Stock only leaves the warehouse through an approved request. | لا يخرج المخزون من المستودع إلا عبر طلب معتمد. | |
| 445 | Inventory | No requests yet. | لا طلبات بعد. | |
| 446 | Inventory | Filter | تصفية | |
| 447 | Inventory | All requests | كل الطلبات | |
| 448 | Inventory | ← Stock requests | ← طلبات المخزون | |
| 449 | Inventory | New stock request | طلب مخزون جديد | |
| 450 | Inventory | The quantity is reserved as soon as you submit, so nobody else can take it while a manager decides. | تُحجز الكمية فور الإرسال، فلا يستطيع أحد غيرك أخذها بينما يقرر المدير. | |
| 451 | Inventory | Take stock from | أخذ المخزون من | |
| 452 | Inventory | Customer order, internal use… | طلب عميل، استخدام داخلي… | |
| 453 | Inventory | ({n} available) | ({n} متاح) | |
| 454 | Inventory | Add another item | إضافة صنف آخر | |
| 455 | Inventory | Submit for approval | إرسال للموافقة | |
| 456 | Inventory | Requested by {who} on {date} from {warehouse}. Reason: {reason}. | طلبه {who} بتاريخ {date} من {warehouse}. السبب: {reason}. | |
| 457 | Inventory | none given | لم يُذكر | |
| 458 | Inventory | For sales order | لأمر بيع | |
| 459 | Inventory | Decision by | القرار من | |
| 460 | Inventory | Manager decision | قرار المدير | |
| 461 | Inventory | Comment (optional) | تعليق (اختياري) | |
| 462 | Inventory | Try approving a request you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else. | جرّب الموافقة على طلب قدّمته بنفسك: سيُرفض. بدّل الشخص من الشريط الأصفر لتوافق بصفة شخص آخر. | |
| 463 | Inventory | Waiting for a manager to approve. | بانتظار موافقة مدير. | |
| 464 | Inventory |  Switch to Layla Hassan or Karim Adel in the yellow bar to approve it. | بدّل إلى ليلى حسن أو كريم عادل من الشريط الأصفر لتوافق عليه. | |
| 465 | Inventory | Issue stock | صرف المخزون | |
| 466 | Inventory | Cancel request | إلغاء الطلب | |
| 467 | Inventory | History | السجل | |
| 468 | Inventory | Written by the system in the same step as each change. | يكتبه النظام في الخطوة نفسها مع كل تغيير. | |
| 469 | Inventory | No history yet. | لا سجل بعد. | |
| 470 | Inventory | Type | النوع | |
| 471 | Inventory | opening stock | مخزون افتتاحي | |
| 472 | Inventory | Posted by | سجّله | |
| 473 | Inventory | Every movement, newest first. Entries are only ever added, never edited. An outgoing movement always points at an approved request. | كل حركة، الأحدث أولًا. تُضاف القيود فقط ولا تُعدَّل أبدًا. وكل حركة خارجة تشير دائمًا إلى طلب معتمد. | |
| 474 | Transfers | Approved, ready to dispatch | معتمد وجاهز للإرسال | |
| 475 | Transfers | In transit | في الطريق | |
| 476 | Transfers | Transfer progress | سير التحويل | |
| 477 | Transfers | From → to | من ← إلى | |
| 478 | Transfers | Move stock between warehouses. A manager approves first; stock then leaves the source, sits in transit, and enters the destination when received. | انقل المخزون بين المستودعات. يوافق مدير أولًا، ثم يغادر المخزون المصدر، ويبقى في الطريق، ويدخل الوجهة عند الاستلام. | |
| 479 | Transfers | In transit now | في الطريق الآن | |
| 480 | Transfers | Dispatched and not yet received. This stock belongs to no warehouse, so nobody can sell it meanwhile. | أُرسل ولم يُستلم بعد. هذا المخزون لا يتبع أي مستودع، فلا يمكن لأحد بيعه في الأثناء. | |
| 481 | Transfers | in {n} transfer | في {n} تحويل | |
| 482 | Transfers | in {n} transfers | في {n} تحويلات | |
| 483 | Transfers | No transfers yet. | لا تحويلات بعد. | |
| 484 | Transfers | All transfers | كل التحويلات | |
| 485 | Transfers | ← Stock transfers | ← تحويلات المخزون | |
| 486 | Transfers | The stock is reserved at the source as soon as you submit, and a manager must approve before anything moves. | يُحجز المخزون في المصدر فور الإرسال، ويجب أن يوافق مدير قبل أن يتحرك أي شيء. | |
| 487 | Transfers | From warehouse | من مستودع | |
| 488 | Transfers | To warehouse | إلى مستودع | |
| 489 | Transfers | Choose two different warehouses. | اختر مستودعين مختلفين. | |
| 490 | Transfers | Available here: | المتاح هنا: | |
| 491 | Transfers | Restock the branch, move to the cold room… | تموين الفرع، النقل إلى غرفة التبريد… | |
| 492 | Transfers | Submit transfer | إرسال التحويل | |
| 493 | Transfers | Requested by {who} on {date}. Reason: {reason}. | طلبه {who} بتاريخ {date}. السبب: {reason}. | |
| 494 | Transfers | Approved or decided by {who} | وافق عليه أو قرر فيه {who} | |
| 495 | Transfers | Dispatched by | أرسله | |
| 496 | Transfers | Received by | استلمه | |
| 497 | Transfers | Batches moved | الدفعات المنقولة | |
| 498 | Transfers | The first batches to expire go first. The destination receives the same batches with the same expiry dates. | الدفعات الأقرب انتهاءً تخرج أولًا. وتستلم الوجهة الدفعات نفسها بتواريخ الانتهاء نفسها. | |
| 499 | Transfers | No expiry | بلا تاريخ انتهاء | |
| 500 | Transfers | Approvals | الموافقات | |
| 501 | Transfers | Decision | القرار | |
| 502 | Transfers | Via | عبر | |
| 503 | Transfers | Comment | تعليق | |
| 504 | Transfers | Try approving a transfer you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else. | جرّب الموافقة على تحويل قدّمته بنفسك: سيُرفض. بدّل الشخص من الشريط الأصفر لتوافق بصفة شخص آخر. | |
| 505 | Transfers | Dispatch | إرسال | |
| 506 | Transfers | Receive at destination | استلام في الوجهة | |
| 507 | Transfers | Cancel transfer | إلغاء التحويل | |
| 508 | Transfers | Approved. Waiting for the source warehouse to dispatch it. | تمت الموافقة. بانتظار أن يرسله مستودع المصدر. | |
| 509 | Transfers | In transit. Waiting for the destination warehouse to receive it. | في الطريق. بانتظار أن يستلمه مستودع الوجهة. | |
| 510 | ConnectPhone | Connect your WhatsApp | اربط واتساب الخاص بك | |
| 511 | ConnectPhone | Approve or reject stock requests and answer tasks from WhatsApp. Every answer is saved with who gave it and from which number. Only a number you have confirmed here is trusted. | وافق على طلبات المخزون أو ارفضها وأجب عن المهام من واتساب. تُحفظ كل إجابة مع اسم صاحبها والرقم الذي أرسلها. لا يُوثق إلا بالرقم الذي أكدته هنا. | |
| 512 | ConnectPhone | Add a number | إضافة رقم | |
| 513 | ConnectPhone | WhatsApp number with country code | رقم واتساب مع رمز الدولة | |
| 514 | ConnectPhone | Send me a code | أرسل لي رمزًا | |
| 515 | ConnectPhone | Your numbers | أرقامك | |
| 516 | ConnectPhone | Confirm | تأكيد | |
| 517 | ConnectPhone | Confirmed | مؤكّد | |
| 518 | ConnectPhone | Waiting for the code | بانتظار الرمز | |
| 519 | ConnectPhone | 6-digit code | رمز من 6 أرقام | |
| 520 | ConnectPhone | No numbers yet. | لا أرقام بعد. | |
| 521 | Messaging | Message | الرسالة | |
| 522 | Messaging | Open | فتح | |
| 523 | Messaging | Messages sent to you. Opening one takes you to the request or task; deciding still happens there. | الرسائل المرسلة إليك. فتح إحداها يأخذك إلى الطلب أو المهمة؛ ويبقى اتخاذ القرار هناك. | |
| 524 | Messaging | Mark all read ( | تعليم الكل كمقروء ( | |
| 525 | Messaging | Reminders queued: {reminders}. Escalations queued: {escalations}. Low-stock messages: {lowStock}. Alert rules fired: {alerts}. Audit check: {auditCheck}. Messages delivered: {sent}. | تذكيرات في الانتظار: {reminders}. تصعيدات في الانتظار: {escalations}. رسائل المخزون المنخفض: {lowStock}. قواعد تنبيه أُطلقت: {alerts}. فحص السجل: {auditCheck}. رسائل سُلّمت: {sent}. | |
| 526 | Messaging | Failed: {n}. | فشل: {n}. | |
| 527 | Messaging | Queued | في الانتظار | |
| 528 | Messaging | Kind | النوع | |
| 529 | Messaging | Channel | القناة | |
| 530 | Messaging | Tries | المحاولات | |
| 531 | Messaging | Every message the system queued, and whether it was delivered. Failed sends are retried with a growing delay, and messages that wait too long expire. A background job runs every five minutes; you can run it now. | كل رسالة وضعها النظام في الانتظار، وهل سُلّمت. تُعاد محاولة الإرسال الفاشل بفاصل متزايد، وتنتهي صلاحية الرسائل التي تنتظر طويلًا. تعمل مهمة في الخلفية كل خمس دقائق؛ ويمكنك تشغيلها الآن. | |
| 532 | Messaging | No messages yet. | لا رسائل بعد. | |
| 533 | Messaging | Running… | جارٍ التشغيل… | |
| 534 | Messaging | Run delivery and reminders now | شغّل التسليم والتذكيرات الآن | |
| 535 | PurchasingDemo | Waiting for goods | بانتظار البضاعة | |
| 536 | PurchasingDemo | supplier | المورّد | |
| 537 | PurchasingDemo | Order | الطلب | |
| 538 | PurchasingDemo | Deliver to | التسليم إلى | |
| 539 | PurchasingDemo | Total | الإجمالي | |
| 540 | PurchasingDemo | Ordered | تاريخ الطلب | |
| 541 | PurchasingDemo | Goods you have ordered from suppliers. Receiving an order puts the goods into stock. | البضاعة التي طلبتها من الموردين. استلام الطلب يُدخل البضاعة إلى المخزون. | |
| 542 | PurchasingDemo | No purchase orders yet. | لا أوامر شراء بعد. | |
| 543 | PurchasingDemo | Order goods from a supplier. Nothing changes in stock until the goods arrive and you receive the order. | اطلب بضاعة من مورّد. لا يتغير شيء في المخزون حتى تصل البضاعة وتستلم الطلب. | |
| 544 | PurchasingDemo | Unit cost | تكلفة الوحدة | |
| 545 | PurchasingDemo | Place order | تقديم الطلب | |
| 546 | PurchasingDemo | ← Purchase orders | ← أوامر الشراء | |
| 547 | PurchasingDemo | ) · deliver to | ) · التسليم إلى | |
| 548 | PurchasingDemo | · ordered | · تاريخ الطلب | |
| 549 | PurchasingDemo | · received | · تاريخ الاستلام | |
| 550 | PurchasingDemo | Line total | إجمالي السطر | |
| 551 | PurchasingDemo | Receive goods | استلام البضاعة | |
| 552 | PurchasingDemo | Cancel order | إلغاء الطلب | |
| 553 | PurchasingDemo | The goods are in stock. | البضاعة الآن في المخزون. | |
| 554 | PurchasingDemo | See the receipts in the stock ledger | اطّلع على الإيصالات في دفتر المخزون | |
| 555 | PurchasingDemo | check stock on hand | تحقق من المخزون الموجود | |
| 556 | SupplierInvoices | Supplier invoice recorded. | سُجّلت فاتورة المورّد. | |
| 557 | SupplierInvoices | Record supplier bills against received purchase orders and track billed quantities. | سجّل فواتير الموردين مقابل أوامر الشراء المستلمة وتتبّع الكميات المفوترة. | |
| 558 | SupplierInvoices | Record an invoice | تسجيل فاتورة | |
| 559 | SupplierInvoices | Received purchase order | أمر شراء مستلم | |
| 560 | SupplierInvoices | Choose an order… | اختر أمرًا… | |
| 561 | SupplierInvoices | Supplier invoice number | رقم فاتورة المورّد | |
| 562 | SupplierInvoices | Invoice date | تاريخ الفاتورة | |
| 563 | SupplierInvoices | Already billed | فُوتر سابقًا | |
| 564 | SupplierInvoices | Billed on this invoice | المفوتر في هذه الفاتورة | |
| 565 | SupplierInvoices | Quantity billed for {item} | الكمية المفوترة للصنف {item} | |
| 566 | SupplierInvoices | Recording… | جارٍ التسجيل… | |
| 567 | SupplierInvoices | Record supplier invoice | تسجيل فاتورة مورّد | |
| 568 | SupplierInvoices | Received orders and billing progress | الطلبات المستلمة وتقدم الفوترة | |
| 569 | SupplierInvoices | Received value | قيمة المستلم | |
| 570 | SupplierInvoices | Billed value | قيمة المفوتر | |
| 571 | SupplierInvoices | Remaining | المتبقي | |
| 572 | SupplierInvoices | Not billed | غير مفوتر | |
| 573 | SupplierInvoices | Fully billed | مفوتر بالكامل | |
| 574 | SupplierInvoices | Part billed | مفوتر جزئيًا | |
| 575 | SupplierInvoices | No received purchase orders to bill yet. | لا أوامر شراء مستلمة لفوترتها بعد. | |
| 576 | SupplierInvoices | Recorded invoices | الفواتير المسجّلة | |
| 577 | SupplierInvoices | Invoice | الفاتورة | |
| 578 | SupplierInvoices | Date recorded | تاريخ التسجيل | |
| 579 | SupplierInvoices | No supplier invoices recorded yet. | لا فواتير موردين مسجّلة بعد. | |
| 580 | CustomerInvoices | Fully invoiced | مفوتر بالكامل | |
| 581 | CustomerInvoices | Not fully invoiced | غير مفوتر بالكامل | |
| 582 | CustomerInvoices | Not delivered yet | لم يُسلَّم بعد | |
| 583 | CustomerInvoices | Invoiced more than delivered | مفوتر أكثر من المسلَّم | |
| 584 | CustomerInvoices | Invoice {number} created. | أُنشئت الفاتورة {number}. | |
| 585 | CustomerInvoices | Invoice voided. Its quantity can be invoiced again. | أُبطلت الفاتورة. يمكن فوترة كميتها مرة أخرى. | |
| 586 | CustomerInvoices | Bill delivered sales orders. An order can only be invoiced once its stock has been issued, and never for more than was delivered. A wrong invoice is voided, not edited. | فوتِر أوامر البيع المسلَّمة. لا يمكن فوترة الأمر إلا بعد صرف مخزونه، ولا يمكن أبدًا فوترة أكثر مما سُلِّم. الفاتورة الخاطئة تُبطل ولا تُعدَّل. | |
| 587 | CustomerInvoices | Create an invoice | إنشاء فاتورة | |
| 588 | CustomerInvoices | Delivered sales order | أمر بيع مسلَّم | |
| 589 | CustomerInvoices | Delivered | المسلَّم | |
| 590 | CustomerInvoices | Already invoiced | مفوتر سابقًا | |
| 591 | CustomerInvoices | Invoice now | فوتر الآن | |
| 592 | CustomerInvoices | Quantity to invoice for {item} | الكمية المراد فوترتها للصنف {item} | |
| 593 | CustomerInvoices | Create invoice | إنشاء الفاتورة | |
| 594 | CustomerInvoices | Ordered, delivered and invoiced | المطلوب والمسلَّم والمفوتر | |
| 595 | CustomerInvoices | Customer | العميل | |
| 596 | CustomerInvoices | Invoiced | المفوتر | |
| 597 | CustomerInvoices | No sales orders yet. | لا أوامر بيع بعد. | |
| 598 | CustomerInvoices | Invoices | الفواتير | |
| 599 | CustomerInvoices | Created | تاريخ الإنشاء | |
| 600 | CustomerInvoices | No invoices yet. | لا فواتير بعد. | |
| 601 | SalesDemo | New order | أمر جديد | |
| 602 | SalesDemo | Approved, ready to ship | معتمد وجاهز للشحن | |
| 603 | SalesDemo | customer | العميل | |
| 604 | SalesDemo | Ships from | يُشحن من | |
| 605 | SalesDemo | What customers have ordered. Shipping goes through a stock request that a manager approves. | ما طلبه العملاء. يتم الشحن عبر طلب مخزون يوافق عليه مدير. | |
| 606 | SalesDemo | Record what a customer ordered. Stock is not touched until you request it from the warehouse. | سجّل ما طلبه العميل. لا يُمَس المخزون حتى تطلبه من المستودع. | |
| 607 | SalesDemo | Unit price | سعر الوحدة | |
| 608 | SalesDemo | Save order | حفظ الأمر | |
| 609 | SalesDemo | Order taken | استلام الأمر | |
| 610 | SalesDemo | Stock requested | طُلب المخزون | |
| 611 | SalesDemo | This order was cancelled. | أُلغي هذا الأمر. | |
| 612 | SalesDemo | Order progress | سير الأمر | |
| 613 | SalesDemo | ← Sales orders | ← أوامر البيع | |
| 614 | SalesDemo | ) · ships from | ) · يُشحن من | |
| 615 | SalesDemo | Stock request | طلب المخزون | |
| 616 | SalesDemo |  has been issued. |  صُرف. | |
| 617 | SalesDemo |  needs a manager to approve it and the warehouse to issue it. Open it to continue. |  يحتاج إلى موافقة مدير وصرف من المستودع. افتحه للمتابعة. | |
| 618 | SalesDemo | Request stock from warehouse | طلب مخزون من المستودع | |
| 619 | Tasks | To do | للتنفيذ | |
| 620 | Tasks | Acknowledged | تم الاطلاع | |
| 621 | Tasks | New task | مهمة جديدة | |
| 622 | Tasks | What needs doing | ما يجب إنجازه | |
| 623 | Tasks | Count aisle 4 | عدّ الممر 4 | |
| 624 | Tasks | Due | موعد الاستحقاق | |
| 625 | Tasks | Details (optional) | التفاصيل (اختياري) | |
| 626 | Tasks | Assigning… | جارٍ التكليف… | |
| 627 | Tasks | Assign task | تكليف بالمهمة | |
| 628 | Tasks | Assigned by | كلّفه | |
| 629 | Tasks |  (overdue) |  (متأخرة) | |
| 630 | Tasks | Work assigned to people, with a due time. An overdue task triggers a reminder to the assignee and then an escalation to whoever assigned it. | أعمال تُسند إلى الأشخاص بموعد استحقاق. المهمة المتأخرة تُرسل تذكيرًا إلى المكلَّف ثم تصعيدًا إلى من كلّفه. | |
| 631 | Tasks | Nothing assigned to you. | لا شيء مُسند إليك. | |
| 632 | Tasks | No tasks yet. | لا مهام بعد. | |
| 633 | Tasks | Show | عرض | |
| 634 | Tasks | My tasks | مهامي | |
| 635 | Tasks | All tasks | كل المهام | |
| 636 | Tasks | Acknowledge | إقرار بالاطلاع | |
| 637 | Tasks | ← Tasks | ← المهام | |
| 638 | Tasks | For {assignee}, assigned by {creator} on {date}. | إلى {assignee}، كلّفه {creator} بتاريخ {date}. | |
| 639 | Tasks | Completed | مكتملة | |
| 640 | Tasks | Your task | مهمتك | |
| 641 | Tasks | Task actions | إجراءات المهمة | |
| 642 | Tasks | Acknowledge tells {name} you have seen it and are on it. Complete when it is done. | إقرار الاطلاع يُخبر {name} أنك رأيتها وتعمل عليها. اضغط «إنجاز» عند الانتهاء. | |
| 643 | Tasks | Complete | إنجاز | |
| 644 | Tasks | Cancel task | إلغاء المهمة | |
| 645 | common | Contact | جهة الاتصال | |
| 646 | common | City | المدينة | |
| 647 | common | Phone | الهاتف | |
| 648 | common | One record per {noun}, shared by every order. | سجل واحد لكل {noun}، تشترك فيه كل الأوامر. | |
| 649 | common | Add | إضافة | |
| 650 | common | Add {noun} | إضافة {noun} | |
| 651 | common | Contact person | الشخص المسؤول | |
| 652 | common | (EGP) | (EGP) | |
| 653 | (computed) | available | متاح | |
| 654 | (computed) | quarantined | محجور | |
| 655 | (computed) | item | صنف | |
