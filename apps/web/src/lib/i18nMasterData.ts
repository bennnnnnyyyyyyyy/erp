// Arabic for master data and coding (documentation/plans/MASTER_DATA_PLAN.md). Slice A: item groups and item codes (sql/095).
// MACHINE DRAFT for Ben's review, like the other i18n files.

export const MASTER_DATA_AR: Record<string, string> = {
  'Item groups': 'مجموعات الأصناف',
  'Groups and sub-groups organise your items, each with its own code. Under the group code rule a new item gets its groups’ codes and a number, for example 10-03-007.':
    'المجموعات والمجموعات الفرعية تنظّم أصنافك، ولكل منها كود خاص. وفق قاعدة أكواد المجموعات يحصل الصنف الجديد على أكواد مجموعاته ورقم، مثل 10-03-007.',
  'Group added.': 'أُضيفت المجموعة.',
  'Group saved. Items already coded keep their codes.': 'حُفظت المجموعة. الأصناف المكوّدة من قبل تحتفظ بأكوادها.',
  'Item code rule saved.': 'حُفظت قاعدة أكواد الأصناف.',
  'Add group': 'إضافة مجموعة',
  'Edit group': 'تعديل المجموعة',
  'Add sub-group': 'إضافة مجموعة فرعية',
  'Top level': 'المستوى الأعلى',
  'New items can be added to this group': 'يمكن إضافة أصناف جديدة إلى هذه المجموعة',
  'Letters and digits, up to 10. Changing a code or moving a group changes the codes of new items only.':
    'حروف وأرقام، حتى 10. تغيير الكود أو نقل المجموعة يغيّر أكواد الأصناف الجديدة فقط.',
  'No item groups yet.': 'لا توجد مجموعات أصناف بعد.',
  'Closed to new items': 'مغلقة أمام الأصناف الجديدة',
  'Group {code} removed.': 'حُذفت المجموعة {code}.',
  'Item code rule': 'قاعدة أكواد الأصناف',
  'Typed by hand': 'تُكتب يدويًا',
  'Prefix and a number (the SKU format)': 'بادئة ورقم (تنسيق الكود)',
  'Group codes and a number': 'أكواد المجموعات ورقم',
  Separator: 'الفاصل',
  'Every new item then needs a group. Existing items keep their codes.': 'بعدها يحتاج كل صنف جديد إلى مجموعة. الأصناف الحالية تحتفظ بأكوادها.',
  'Save rule': 'حفظ القاعدة',
  'Item group': 'مجموعة الصنف',
  'Choose a group': 'اختر مجموعة',
  'No group': 'بدون مجموعة',
  'The code is built from the group. Items keep their code if they move later.': 'يُبنى الكود من المجموعة. تحتفظ الأصناف بأكوادها إذا نُقلت لاحقًا.',
  'Moving an item to another group keeps its code.': 'نقل الصنف إلى مجموعة أخرى يحافظ على كوده.',
};
