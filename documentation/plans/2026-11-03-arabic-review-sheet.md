# Arabic review sheet: strings new or changed on 2026-11-03

Ben reviews these himself. 216 strings, from `lib/i18nScreens.ts` (screens) and `lib/i18nNav.ts` (menus), compared with commit `c282b86` (start of the day).
Write the correct Arabic in the last column (leave it empty if the current text is right); Claude applies the corrections.
Placeholders such as `{n}`, `{amount}` and `**bold**` markers must stay exactly as they are (a test checks this). The Guide and tour texts
(`modules/help/helpContent.ts`, `tourContent.ts`) were also rewritten today and are not in this table: read them in the app (Guide, Take the tour) in Arabic.

| # | Where | English | Arabic now | New/changed | Correction |
|---|---|---|---|---|---|
| 1 | Screens | You become the owner and every module is enabled. All of this can be changed later in Settings. | تصبح المالك وتُفعَّل كل الوحدات. يمكن تغيير كل ذلك لاحقًا من الإعدادات. | new | |
| 2 | Screens | Stock below reorder level | المخزون تحت حد إعادة الطلب | new | |
| 3 | Screens | Leave blank to use each item's reorder level. | اتركه فارغًا لاستخدام حد إعادة الطلب لكل صنف. | new | |
| 4 | Screens | Batch nearing expiry | تشغيلة قريبة من انتهاء الصلاحية | new | |
| 5 | Screens | Includes batches that have already expired. | يشمل التشغيلات منتهية الصلاحية. | new | |
| 6 | Screens | Customer invoice overdue | فاتورة عميل متأخرة | new | |
| 7 | Screens | Month-to-date net loss | صافي خسارة منذ بداية الشهر | new | |
| 8 | Screens | Revenue less COGS and operating expenses, month to date. | الإيرادات ناقص تكلفة البضاعة المباعة ومصروفات التشغيل، منذ بداية الشهر. | new | |
| 9 | Screens | Forecast stock-out | نفاد متوقع | new | |
| 10 | Screens | Based on the stock forecast: reports days of cover and forecast confidence. Items with no usage in 90 days are excluded. | يعتمد على توقعات المخزون: يذكر أيام التغطية ودرجة الثقة. تُستبعد الأصناف التي لم تُستهلك خلال 90 يومًا. | new | |
| 11 | Screens | All members | كل الأعضاء | new | |
| 12 | Screens | Alerts for low stock, expiring batches and overdue receivables. | تنبيهات انخفاض المخزون وانتهاء صلاحية التشغيلات والمستحقات المتأخرة. | new | |
| 13 | Screens | Each rule is evaluated every five minutes against current stock, batches and invoices. | تُقيَّم كل قاعدة كل خمس دقائق مقابل المخزون والتشغيلات والفواتير الحالية. | new | |
| 14 | Screens | Recipients | المستلمون | new | |
| 15 | Screens | Repeat interval | فاصل التكرار | new | |
| 16 | Screens | Times triggered | مرات التنبيه | new | |
| 17 | Screens | Send test | إرسال تجربة | new | |
| 18 | Screens | Trigger | شرط التنبيه | new | |
| 19 | Screens | Repeat interval (hours) | فاصل التكرار (ساعات) | new | |
| 20 | Screens | Teams group recipients (for example Purchasing, Warehouse, Management) so a rule can notify a whole team. | تجمع الفرق المستلمين (مثل المشتريات والمستودع والإدارة) لتتمكن القاعدة من تنبيه فريق كامل. | new | |
| 21 | Screens | On track | ضمن المسار | new | |
| 22 | Screens | Watch | للمتابعة | new | |
| 23 | Screens | Action required | يتطلب إجراء | new | |
| 24 | Screens | Profit and loss | الأرباح والخسائر | new | |
| 25 | Screens | Net profit after cost of goods sold and operating expenses | صافي الربح بعد تكلفة البضاعة المباعة ومصروفات التشغيل | new | |
| 26 | Screens | Net loss {amount} | صافي خسارة {amount} | new | |
| 27 | Screens | Net profit {amount} | صافي ربح {amount} | new | |
| 28 | Screens | {month}: revenue {revenue}, COGS {cogs}, operating expenses {expenses}. | {month}: الإيرادات {revenue}، تكلفة البضاعة المباعة {cogs}، مصروفات التشغيل {expenses}. | new | |
| 29 | Screens | Last 12 months: net loss {amount}. | آخر 12 شهرًا: صافي خسارة {amount}. | new | |
| 30 | Screens | Last 12 months: net profit {amount}. | آخر 12 شهرًا: صافي ربح {amount}. | new | |
| 31 | Screens | Month to date: net loss {amount}. | منذ بداية الشهر: صافي خسارة {amount}. | new | |
| 32 | Screens | Month to date: net profit {amount}. | منذ بداية الشهر: صافي ربح {amount}. | new | |
| 33 | Screens | Month to date: no transactions yet. | منذ بداية الشهر: لا معاملات بعد. | new | |
| 34 | Screens | Receivables and payables | المستحقات والالتزامات | new | |
| 35 | Screens | Accounts receivable and accounts payable | الذمم المدينة والذمم الدائنة | new | |
| 36 | Screens | open balances as of {date} | الأرصدة المفتوحة حتى {date} | new | |
| 37 | Screens | receivable from customers, of which **{late}** is more than 30 days overdue. | مستحقة من العملاء، منها **{late}** متأخرة أكثر من 30 يومًا. | new | |
| 38 | Screens | receivable from customers. | مستحقة من العملاء. | new | |
| 39 | Screens | Accounts payable (suppliers and expenses): **{amount}**. | الذمم الدائنة (الموردون والمصروفات): **{amount}**. | new | |
| 40 | Screens | Pending approvals | موافقات معلّقة | new | |
| 41 | Screens | Stock requests awaiting manager approval | طلبات مخزون بانتظار موافقة المدير | new | |
| 42 | Screens | {n} approved, awaiting goods issue. | {n} معتمدة بانتظار الصرف. | new | |
| 43 | Screens | Inventory value and expiry | قيمة المخزون والصلاحية | new | |
| 44 | Screens | Inventory valuation at cost and batches nearing expiry | تقييم المخزون بالتكلفة والتشغيلات القريبة من انتهاء الصلاحية | new | |
| 45 | Screens | inventory value at cost. | قيمة المخزون بالتكلفة. | new | |
| 46 | Screens | Top products | الأصناف الأكثر مبيعًا | new | |
| 47 | Screens | Products ranked by sales revenue | الأصناف مرتبة حسب إيرادات المبيعات | new | |
| 48 | Screens | Supplier concentration | تركّز الموردين | new | |
| 49 | Screens | Share of purchase spend by supplier | حصة كل مورد من إنفاق المشتريات | new | |
| 50 | Screens | As of {datetime}. Management accounts: excludes VAT; COGS at weighted average cost; overdue means unpaid after 30 days. Not statutory financial statements. | حتى {datetime}. حسابات إدارية: لا تشمل ضريبة القيمة المضافة؛ تكلفة البضاعة المباعة بالمتوسط المرجّح؛ المتأخر يعني غير مسدّد بعد 30 يومًا. ليست قوائم مالية نظامية. | new | |
| 51 | Screens | Modules enabled for {org}. Disabling a module hides it but keeps its data. | الوحدات المفعّلة في {org}. إيقاف وحدة يخفيها ويحتفظ ببياناتها. | new | |
| 52 | Screens | Append-only record of every change in {org}, newest first. Entries cannot be edited or deleted. | سجل غير قابل للتعديل لكل تغيير في {org}، الأحدث أولًا. لا يمكن تعديل القيود أو حذفها. | new | |
| 53 | Screens | Company profile and system-wide defaults. | ملف الشركة والإعدادات الافتراضية للنظام. | new | |
| 54 | Screens | Users of {org} and their roles. | مستخدمو {org} وأدوارهم. | new | |
| 55 | Screens | Pending invitations | دعوات معلّقة | new | |
| 56 | Screens | Operating expenses such as rent, salaries, utilities and transport. | مصروفات التشغيل مثل الإيجار والرواتب والمرافق والنقل. | new | |
| 57 | Screens | Purchase invoice {number} | فاتورة مشتريات {number} | new | |
| 58 | Screens | Customer receipts, and payments to suppliers and for expenses. | تحصيلات العملاء، والمدفوعات للموردين وللمصروفات. | new | |
| 59 | Screens | Payment type | نوع الدفعة | new | |
| 60 | Screens | Customer receipt | تحصيل من عميل | new | |
| 61 | Screens | Payment to supplier or expense | دفع لمورد أو مصروف | new | |
| 62 | Screens | · outstanding | · مستحق | new | |
| 63 | Screens | Exceeds the outstanding balance of {amount}. | يتجاوز الرصيد المستحق البالغ {amount}. | new | |
| 64 | Screens | Monthly revenue, cost of goods sold and operating expenses. | الإيرادات وتكلفة البضاعة المباعة ومصروفات التشغيل شهريًا. | new | |
| 65 | Screens | Net profit, last 12 months | صافي الربح، آخر 12 شهرًا | new | |
| 66 | Screens | Revenue, last 12 months | الإيرادات، آخر 12 شهرًا | new | |
| 67 | Screens | Total costs, last 12 months | إجمالي التكاليف، آخر 12 شهرًا | new | |
| 68 | Screens | {cogs} COGS + {expenses} operating expenses | {cogs} تكلفة البضاعة المباعة + {expenses} مصروفات التشغيل | new | |
| 69 | Screens | Loss-making months, last 12 months | أشهر الخسارة، آخر 12 شهرًا | new | |
| 70 | Screens | Revenue vs costs by month | الإيرادات مقابل التكاليف شهريًا | new | |
| 71 | Screens | Monthly revenue and costs, last 12 months | الإيرادات والتكاليف الشهرية، آخر 12 شهرًا | new | |
| 72 | Screens | {month}: revenue {sales}, costs {costs}, net {result} | {month}: الإيرادات {sales}، التكاليف {costs}، الصافي {result} | new | |
| 73 | Screens | Green marker: net profit for the month; red: net loss. Hover a month for details. | العلامة الخضراء: صافي ربح الشهر؛ الحمراء: صافي خسارة. مرّر المؤشر على الشهر لعرض التفاصيل. | new | |
| 74 | Screens | Cost of goods sold | تكلفة البضاعة المباعة | new | |
| 75 | Screens | Operating expenses | مصروفات التشغيل | new | |
| 76 | Screens | Net profit | صافي الربح | new | |
| 77 | Screens | no transactions | لا معاملات | new | |
| 78 | Screens | Batch and expiry tracking. Stock is issued first-expiry, first-out (FEFO). | تتبّع التشغيلات والصلاحية. يُصرف المخزون بالأقرب انتهاءً أولًا (FEFO). | new | |
| 79 | Screens | Storage condition | شرط التخزين | new | |
| 80 | Screens | No requirement | بلا شرط | new | |
| 81 | Screens | Projected stock-out dates from the last 90 days of usage. | تواريخ النفاد المتوقعة بناءً على استهلاك آخر 90 يومًا. | new | |
| 82 | Screens | Stock-out within 14 days | نفاد خلال 14 يومًا | new | |
| 83 | Screens | Reorder suggested | يُقترح إعادة الطلب | new | |
| 84 | Screens | Avg. daily usage | متوسط الاستهلاك اليومي | new | |
| 85 | Screens | Stock-out date | تاريخ النفاد | new | |
| 86 | Screens | Confidence | درجة الثقة | new | |
| 87 | Screens | Lead time | مدة التوريد | new | |
| 88 | Screens | On order | قيد الطلب | new | |
| 89 | Screens | no usage in 90 days | لا استهلاك خلال 90 يومًا | new | |
| 90 | Screens | High | مرتفعة | new | |
| 91 | Screens | Low (limited history) | منخفضة (سجل محدود) | new | |
| 92 | Screens | On-hand, reserved and available quantities by warehouse. | الكميات المتوفرة والمحجوزة والمتاحة حسب المستودع. | new | |
| 93 | Screens | awaiting manager approval | بانتظار موافقة المدير | new | |
| 94 | Screens | Minimum available quantity per item before reordering. | الحد الأدنى للكمية المتاحة لكل صنف قبل إعادة الطلب. | new | |
| 95 | Screens | Thresholds above which a stock request needs more than one approval. | الحدود التي يحتاج بعدها طلب المخزون إلى أكثر من موافقة. | new | |
| 96 | Screens | Cycle counts. A manager approves any variance before it is posted. | الجرد الدوري. يوافق مدير على أي فرق قبل ترحيله. | new | |
| 97 | Screens | System quantity: | الكمية في النظام: | new | |
| 98 | Screens | Goods are issued only against an approved request. | لا تُصرف البضائع إلا مقابل طلب معتمد. | new | |
| 99 | Screens | ← Stock requests | → طلبات المخزون | changed | |
| 100 | Screens | Requested quantities are reserved until a manager decides. | تُحجز الكميات المطلوبة حتى يقرر المدير. | new | |
| 101 | Screens | Issue from warehouse | الصرف من المستودع | new | |
| 102 | Screens | Every stock movement, newest first. Entries are never edited. | كل حركة مخزون، الأحدث أولًا. لا تُعدَّل القيود أبدًا. | new | |
| 103 | Screens | Inter-warehouse transfers, approved before dispatch. | التحويلات بين المستودعات، تُعتمد قبل الإرسال. | new | |
| 104 | Screens | Dispatched, not yet received. Stock in transit is not available in any warehouse. | أُرسلت ولم تُستلم بعد. المخزون قيد النقل غير متاح في أي مستودع. | new | |
| 105 | Screens | ← Stock transfers | → تحويلات المخزون | changed | |
| 106 | Screens | Quantities are reserved at the source warehouse until approval. | تُحجز الكميات في المستودع المصدر حتى الاعتماد. | new | |
| 107 | Screens | Approved. Awaiting dispatch from the source warehouse. | معتمد. بانتظار الإرسال من المستودع المصدر. | new | |
| 108 | Screens | In transit. Awaiting receipt at the destination warehouse. | قيد النقل. بانتظار الاستلام في المستودع الوجهة. | new | |
| 109 | Screens | Approve requests and answer tasks from WhatsApp. | وافق على الطلبات وأجب عن المهام من واتساب. | new | |
| 110 | Screens | Your notifications. Each one opens the related request or task. | إشعاراتك. يفتح كل إشعار الطلب أو المهمة المرتبطة. | new | |
| 111 | Screens | Attempts | المحاولات | new | |
| 112 | Screens | Outgoing messages and their delivery status. | الرسائل الصادرة وحالة تسليمها. | new | |
| 113 | Screens | Awaiting receipt | بانتظار الاستلام | new | |
| 114 | Screens | Purchase orders to suppliers. Goods receipt posts the quantities to stock. | أوامر الشراء للموردين. يرحّل استلام البضائع الكميات إلى المخزون. | new | |
| 115 | Screens | Stock is updated only when goods are received against the order. | لا يتغير المخزون إلا عند استلام البضائع مقابل الأمر. | new | |
| 116 | Screens | ← Purchase orders | → أوامر الشراء | changed | |
| 117 | Screens | Purchase invoice recorded. | سُجّلت فاتورة المشتريات. | new | |
| 118 | Screens | Supplier invoices matched against received purchase orders. | فواتير الموردين مطابَقة مع أوامر الشراء المستلمة. | new | |
| 119 | Screens | Supplier's invoice number | رقم فاتورة المورد | new | |
| 120 | Screens | Quantity on this invoice | الكمية في هذه الفاتورة | new | |
| 121 | Screens | Record purchase invoice | تسجيل فاتورة المشتريات | new | |
| 122 | Screens | Unbilled | غير مفوتر | new | |
| 123 | Screens | No purchase invoices yet. | لا فواتير مشتريات بعد. | new | |
| 124 | Screens | Invoice delivered sales orders. A wrong invoice is voided, not edited. | فوتِر أوامر البيع المسلَّمة. الفاتورة الخاطئة تُبطل ولا تُعدَّل. | new | |
| 125 | Screens | Quantity to invoice | الكمية المراد فوترتها | new | |
| 126 | Screens | Billing status | حالة الفوترة | new | |
| 127 | Screens | System | النظام | new | |
| 128 | Screens | {paid} paid · {left} outstanding | مدفوع {paid} · مستحق {left} | new | |
| 129 | Screens | Paid in full | مدفوعة بالكامل | new | |
| 130 | Screens | No payments recorded yet. | لا مدفوعات مسجّلة بعد. | new | |
| 131 | Screens | Record a payment → | تسجيل دفعة ← | new | |
| 132 | Screens | ← Payments | → المدفوعات | new | |
| 133 | Screens | This payment was not found. | لم يُعثر على هذه الدفعة. | new | |
| 134 | Screens | This payment was voided. It no longer counts towards what has been paid. | أُبطلت هذه الدفعة، ولم تعد تُحتسب ضمن المدفوع. | new | |
| 135 | Screens | Void payment | إبطال الدفعة | new | |
| 136 | Screens | ← Expenses | → المصروفات | new | |
| 137 | Screens | This expense was not found. | لم يُعثر على هذا المصروف. | new | |
| 138 | Screens | Void expense | إبطال المصروف | new | |
| 139 | Screens | ← Sales invoices | → فواتير المبيعات | new | |
| 140 | Screens | This invoice was not found. | لم يُعثر على هذه الفاتورة. | new | |
| 141 | Screens | This invoice was voided. Its quantity can be invoiced again. | أُبطلت هذه الفاتورة. يمكن فوترة كميتها مرة أخرى. | new | |
| 142 | Screens | Void invoice | إبطال الفاتورة | new | |
| 143 | Screens | ← Purchase invoices | → فواتير المشتريات | new | |
| 144 | Screens | Unknown customer | عميل غير معروف | new | |
| 145 | Screens | Skip to content | تخطَّ إلى المحتوى | new | |
| 146 | Screens | Sign out | تسجيل الخروج | new | |
| 147 | Screens | Full name | الاسم الكامل | new | |
| 148 | Screens | {n} items | {n} أصناف | new | |
| 149 | Screens | Yes, switch off | نعم، أوقِفها | new | |
| 150 | Screens | No rules yet. | لا قواعد بعد. | new | |
| 151 | Screens | Your language | لغتك | new | |
| 152 | Screens | Only for you, on every device you sign in on. The Arabic wording is still being reviewed. | لك وحدك، على كل جهاز تسجّل الدخول منه. ما زالت الصياغة العربية قيد المراجعة. | new | |
| 153 | Screens | Company | الشركة | new | |
| 154 | Screens | English (left to right) | الإنجليزية (من اليسار إلى اليمين) | new | |
| 155 | Screens | Arabic (right to left) | العربية (من اليمين إلى اليسار) | new | |
| 156 | Screens | What everyone sees until they choose their own language. | ما يراه الجميع إلى أن يختار كل شخص لغته. | new | |
| 157 | Screens | Yes, disable | نعم، أوقِفه | new | |
| 158 | Screens | Nothing to show yet | لا شيء لعرضه بعد | new | |
| 159 | Screens | This page fills in as soon as you invoice a sale or record an expense. | تمتلئ هذه الصفحة بمجرد فوترة عملية بيع أو تسجيل مصروف. | new | |
| 160 | Screens | {n} of {total} | {n} من {total} | new | |
| 161 | Screens | Active | نشط | new | |
| 162 | Screens | Invited | مدعو | new | |
| 163 | Screens | Disabled | موقوف | new | |
| 164 | Screens | No transactions yet. Net profit appears once sales are invoiced and expenses recorded. | لا معاملات بعد. يظهر صافي الربح بعد فوترة المبيعات وتسجيل المصروفات. | new | |
| 165 | Screens | No item is below its reorder level. | لا يوجد صنف تحت حد إعادة الطلب. | new | |
| 166 | Screens | Every item has more than one supplier. | لكل صنف أكثر من مورد. | new | |
| 167 | Screens | {n} batch has expired | انتهت صلاحية {n} تشغيلة | new | |
| 168 | Screens | {n} batches have expired | انتهت صلاحية {n} تشغيلات | new | |
| 169 | Screens | {n} item is at or below its reorder level | {n} صنف عند حد إعادة الطلب أو أقل | new | |
| 170 | Screens | {n} items are at or below their reorder level | {n} أصناف عند حد إعادة الطلب أو أقل | new | |
| 171 | Screens | {n} item comes from only one supplier. | {n} صنف يأتي من مورد واحد فقط. | new | |
| 172 | Screens | {n} items come from only one supplier. | {n} أصناف تأتي من مورد واحد فقط. | new | |
| 173 | Screens | Management accounts: COGS at weighted average cost, operating expenses as recorded, excluding VAT. Not statutory financial statements. | حسابات إدارية: تكلفة البضاعة المباعة بالمتوسط المرجّح، ومصروفات التشغيل كما سُجّلت، دون ضريبة القيمة المضافة. ليست قوائم مالية نظامية. | new | |
| 174 | Screens | No reorder level set | لم يُحدَّد حد لإعادة الطلب | new | |
| 175 | Screens | Low | منخفض | new | |
| 176 | Screens | OK | جيد | new | |
| 177 | Screens | in {n} warehouses | في {n} مستودعات | new | |
| 178 | Screens | Low on stock | مخزون منخفض | new | |
| 179 | Screens | at or below their reorder level | عند حد إعادة الطلب أو أقل | new | |
| 180 | Screens | nothing below its reorder level | لا شيء تحت حد إعادة الطلب | new | |
| 181 | Screens | items with reserved stock | أصناف بها مخزون محجوز | new | |
| 182 | Screens | Yes, void it | نعم، أبطِلها | new | |
| 183 | Screens | Void this payment? It can not be undone. | إبطال هذه الدفعة؟ لا يمكن التراجع عن ذلك. | new | |
| 184 | Screens | Void this expense? It can not be undone. | إبطال هذا المصروف؟ لا يمكن التراجع عن ذلك. | new | |
| 185 | Screens | Void this invoice? It can not be undone; its quantity can then be invoiced again. | إبطال هذه الفاتورة؟ لا يمكن التراجع عن ذلك، ويمكن بعدها فوترة كميتها مرة أخرى. | new | |
| 186 | Screens | + {count} more | و{count} أخرى | new | |
| 187 | Screens | Orders to invoice | أوامر للفوترة | new | |
| 188 | Screens | Only orders that need attention | الأوامر التي تحتاج إلى متابعة فقط | new | |
| 189 | Screens | Show all {count} orders | عرض كل الأوامر ({count}) | new | |
| 190 | Screens | Every order is fully invoiced. | كل الأوامر مفوترة بالكامل. | new | |
| 191 | Screens | Received orders to bill | أوامر مستلمة للفوترة | new | |
| 192 | Screens | Every received order is fully billed. | كل الأوامر المستلمة مفوترة بالكامل. | new | |
| 193 | Screens | Customer orders. Goods are issued through a manager-approved stock request. | أوامر العملاء. تُصرف البضائع عبر طلب مخزون يعتمده مدير. | new | |
| 194 | Screens | Stock is reserved only when a stock request is raised for the order. | لا يُحجز المخزون إلا عند إنشاء طلب مخزون للأمر. | new | |
| 195 | Screens | Order placed | تم تسجيل الأمر | new | |
| 196 | Screens | ← Sales orders | → أوامر البيع | changed | |
| 197 | Screens | Task | المهمة | new | |
| 198 | Screens | Assigned tasks with due dates, reminders and escalation. | المهام المسندة بمواعيد استحقاق وتذكيرات وتصعيد. | new | |
| 199 | Screens | ← Tasks | → المهام | changed | |
| 200 | Menu | Stock, requests, approvals, transfers and the stock ledger | المخزون والطلبات والموافقات والتحويلات وسجل المخزون | new | |
| 201 | Menu | Suppliers, purchase orders, goods receipt and purchase invoices | الموردون وأوامر الشراء واستلام البضائع وفواتير المشتريات | new | |
| 202 | Menu | Sales orders, invoicing and customers | أوامر البيع والفوترة والعملاء | new | |
| 203 | Menu | Task assignment, due dates and follow-up | إسناد المهام ومواعيد الاستحقاق والمتابعة | new | |
| 204 | Menu | Notifications and message delivery status | الإشعارات وحالة تسليم الرسائل | new | |
| 205 | Menu | Expenses, payments and profit and loss | المصروفات والمدفوعات والأرباح والخسائر | new | |
| 206 | Menu | Setup checklist for a new company | قائمة إعداد شركة جديدة | new | |
| 207 | Menu | Alerts for low stock, expiring batches and overdue receivables | تنبيهات انخفاض المخزون وانتهاء صلاحية التشغيلات والمستحقات المتأخرة | new | |
| 208 | Menu | User guide and guided tour | دليل المستخدم والجولة الإرشادية | new | |
| 209 | Menu | Purchase invoices | فواتير المشتريات | new | |
| 210 | Menu | Purchase invoice | فاتورة مشتريات | new | |
| 211 | Menu | Sales invoices | فواتير المبيعات | new | |
| 212 | Menu | Sales invoice | فاتورة مبيعات | new | |
| 213 | Menu | Expense | مصروف | new | |
| 214 | Menu | Profit and loss | الأرباح والخسائر | new | |
| 215 | Menu | Payment | دفعة | new | |
| 216 | Menu | Alert rules | قواعد التنبيه | new | |
