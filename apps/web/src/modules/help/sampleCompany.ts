// The sample company used by the setup wizard's "Fill with sample data" (documentation/plans/ONBOARDING_WIZARD_PLAN.md, Part B).
// A fixed copy of the master data in sql/seed/004_cosmetics_factory_demo.sql (Demo Cosmetics Factory), so a company filled with it
// looks like "the same business, before its first year". Only the master data is copied, never the history: that is what switching to
// Demo Cosmetics Factory shows. onboardingSample.test.ts checks every code, name, unit and cost against the seed file.
// Every name is invented; suppliers and customers keep the "(sample)" mark exactly as in the seed.

export type SampleCondition = { key: 'ambient' | 'cold'; name: string; minTempC: number; maxTempC: number };
export type SampleWarehouse = { code: string; name: string; nameAr: string; condition: SampleCondition['key'] };
export type SampleItem = { sku: string; name: string; nameAr: string; uom: string; costMinor: number; warehouse: string; cold: boolean; openingQty: number };
export type SampleParty = { name: string; contact: string; city: string };

export const SAMPLE_CONDITIONS: SampleCondition[] = [
  { key: 'ambient', name: 'Ambient', minTempC: 15, maxTempC: 25 },
  { key: 'cold', name: 'Cold room', minTempC: 2, maxTempC: 8 },
];

export const SAMPLE_WAREHOUSES: SampleWarehouse[] = [
  { code: 'RAW', name: 'Raw materials', nameAr: 'المواد الخام', condition: 'ambient' },
  { code: 'PACK', name: 'Packaging', nameAr: 'مواد التعبئة', condition: 'ambient' },
  { code: 'COLD', name: 'Cold room', nameAr: 'غرفة التبريد', condition: 'cold' },
  { code: 'FG', name: 'Finished goods', nameAr: 'المنتجات الجاهزة', condition: 'ambient' },
  { code: 'QRN', name: 'Quarantine', nameAr: 'الحجر', condition: 'ambient' },
];

// The 12 finished goods, plus a few raw materials and packaging items, at the seed's average cost. Opening quantities are a plausible
// "stock on day one" (the seed builds its stock from a year of history instead).
export const SAMPLE_ITEMS: SampleItem[] = [
  { sku: 'F-SHA', name: 'Shampoo 400 ml', nameAr: 'شامبو 400 مل', uom: 'piece', costMinor: 2400, warehouse: 'FG', cold: false, openingQty: 600 },
  { sku: 'F-CON', name: 'Conditioner 400 ml', nameAr: 'بلسم 400 مل', uom: 'piece', costMinor: 2600, warehouse: 'FG', cold: false, openingQty: 450 },
  { sku: 'F-LOT', name: 'Body lotion 400 ml', nameAr: 'لوشن للجسم 400 مل', uom: 'piece', costMinor: 2900, warehouse: 'FG', cold: false, openingQty: 380 },
  { sku: 'F-HND', name: 'Hand cream 100 ml', nameAr: 'كريم لليدين 100 مل', uom: 'piece', costMinor: 1500, warehouse: 'FG', cold: false, openingQty: 500 },
  { sku: 'F-FWS', name: 'Face wash 150 ml', nameAr: 'غسول للوجه 150 مل', uom: 'piece', costMinor: 2000, warehouse: 'FG', cold: false, openingQty: 320 },
  { sku: 'F-SER', name: 'Vitamin C serum 30 ml', nameAr: 'سيروم فيتامين سي 30 مل', uom: 'piece', costMinor: 6500, warehouse: 'FG', cold: false, openingQty: 150 },
  { sku: 'F-SUN', name: 'Sunscreen SPF 50 100 ml', nameAr: 'واقي شمس SPF 50', uom: 'piece', costMinor: 4200, warehouse: 'FG', cold: false, openingQty: 240 },
  { sku: 'F-LIP', name: 'Lip balm 10 g', nameAr: 'مرطب شفاه', uom: 'piece', costMinor: 700, warehouse: 'FG', cold: false, openingQty: 900 },
  { sku: 'F-SHW', name: 'Shower gel 500 ml', nameAr: 'جل استحمام 500 مل', uom: 'piece', costMinor: 2200, warehouse: 'FG', cold: false, openingQty: 420 },
  { sku: 'F-OIL', name: 'Hair oil 100 ml', nameAr: 'زيت شعر 100 مل', uom: 'piece', costMinor: 3000, warehouse: 'FG', cold: false, openingQty: 260 },
  { sku: 'F-CRM', name: 'Night cream 50 ml', nameAr: 'كريم ليلي 50 مل', uom: 'piece', costMinor: 5200, warehouse: 'FG', cold: false, openingQty: 180 },
  { sku: 'F-MSK', name: 'Clay face mask 100 ml', nameAr: 'ماسك طين للوجه', uom: 'piece', costMinor: 3400, warehouse: 'FG', cold: false, openingQty: 140 },
  { sku: 'R-GLY', name: 'Glycerin', nameAr: 'جلسرين', uom: 'kg', costMinor: 5500, warehouse: 'RAW', cold: false, openingQty: 400 },
  { sku: 'R-SHE', name: 'Shea butter', nameAr: 'زبدة الشيا', uom: 'kg', costMinor: 32000, warehouse: 'RAW', cold: false, openingQty: 80 },
  { sku: 'R-ALO', name: 'Aloe vera extract', nameAr: 'مستخلص الألوفيرا', uom: 'l', costMinor: 18000, warehouse: 'COLD', cold: true, openingQty: 60 },
  { sku: 'R-HYA', name: 'Hyaluronic acid', nameAr: 'حمض الهيالورونيك', uom: 'kg', costMinor: 450000, warehouse: 'COLD', cold: true, openingQty: 2 },
  { sku: 'P-B250', name: 'PET bottle 250 ml', nameAr: 'زجاجة 250 مل', uom: 'piece', costMinor: 650, warehouse: 'PACK', cold: false, openingQty: 5000 },
  { sku: 'P-PUMP', name: 'Pump dispenser', nameAr: 'مضخة', uom: 'piece', costMinor: 300, warehouse: 'PACK', cold: false, openingQty: 4000 },
  { sku: 'P-CTN', name: 'Carton box', nameAr: 'علبة كرتون', uom: 'piece', costMinor: 250, warehouse: 'PACK', cold: false, openingQty: 3000 },
];

export const SAMPLE_SUPPLIERS: SampleParty[] = [
  { name: 'Delta Chemical Trading (sample)', contact: 'Purchasing desk', city: 'Cairo' },
  { name: 'Nile Naturals Oils (sample)', contact: 'Sales desk', city: 'Giza' },
  { name: 'Cairo Actives Import (sample)', contact: 'Account manager', city: 'Cairo' },
  { name: 'Alexandria Minerals (sample)', contact: 'Sales desk', city: 'Alexandria' },
  { name: 'Giza Additives (sample)', contact: 'Sales desk', city: 'Giza' },
  { name: 'Cairo Fragrance Imports (sample)', contact: 'Account manager', city: 'Cairo' },
  { name: 'Suez Surfactants (sample)', contact: 'Sales desk', city: 'Suez' },
  { name: 'Upper Egypt Transport (sample)', contact: 'Dispatcher', city: 'Assiut' },
  { name: 'Delta Plastics (sample)', contact: 'Sales desk', city: 'Tanta' },
  { name: 'Mahalla Cartons (sample)', contact: 'Sales desk', city: 'Mahalla' },
  { name: 'Ismailia Utilities (sample)', contact: 'Billing', city: 'Ismailia' },
  { name: 'Alex Label Printing (sample)', contact: 'Sales desk', city: 'Alexandria' },
];

export const SAMPLE_CUSTOMERS: SampleParty[] = [
  { name: 'Cairo Pharmacy Chain (sample)', contact: 'Buying office', city: 'Cairo' },
  { name: 'Delta Supermarkets Distribution (sample)', contact: 'Buying office', city: 'Mansoura' },
  { name: 'Alexandria Beauty Stores (sample)', contact: 'Owner', city: 'Alexandria' },
  { name: 'Gulf Export Buyer (sample)', contact: 'Export desk', city: 'Cairo' },
  { name: 'Online Beauty Shop (sample)', contact: 'Owner', city: 'Giza' },
  { name: 'Upper Egypt Wholesale (sample)', contact: 'Owner', city: 'Assiut' },
  { name: 'Maadi Care Centers (sample)', contact: 'Buying office', city: 'Cairo' },
  { name: 'Nasr City Cosmetics (sample)', contact: 'Owner', city: 'Cairo' },
  { name: 'Port Said Trading (sample)', contact: 'Owner', city: 'Port Said' },
  { name: 'Hospital Supply Group (sample)', contact: 'Buying office', city: 'Cairo' },
];

export const SAMPLE_COMPANY = { defaultCurrency: 'EGP', timezone: 'Africa/Cairo', dateFormat: 'DD/MM/YYYY' as const };
export const SAMPLE_APPROVAL = { minTotalQty: 100, requiredApprovals: 2 };
