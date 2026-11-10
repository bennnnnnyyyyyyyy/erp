// Common units of measure for items. The English word is what is stored (the unit is a plain text on the item); the label shown is
// translated. Anything else can be typed under "Other…".

export const COMMON_UNITS = ['piece', 'box', 'carton', 'pack', 'kg', 'g', 'litre', 'ml', 'metre', 'dozen', 'pair', 'set'] as const;

export const isCommonUnit = (unit: string): boolean => (COMMON_UNITS as readonly string[]).includes(unit);
