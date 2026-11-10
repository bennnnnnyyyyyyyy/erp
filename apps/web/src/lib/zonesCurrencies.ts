// Time zone and currency lists for the setup and settings forms. Africa/Cairo and EGP come first (Egypt first); everything else follows.

const FALLBACK_ZONES = [
  'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/Chicago', 'America/Los_Angeles', 'America/New_York',
  'America/Sao_Paulo', 'Asia/Amman', 'Asia/Baghdad', 'Asia/Bahrain', 'Asia/Beirut', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kuwait', 'Asia/Muscat',
  'Asia/Qatar', 'Asia/Riyadh', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/Berlin', 'Europe/Istanbul', 'Europe/London', 'Europe/Paris', 'UTC',
];

/** Every IANA time zone the browser knows (fallback list on old browsers), Africa/Cairo first. */
export function timeZoneList(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  let all: string[] = [];
  try {
    all = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    all = [];
  }
  if (all.length === 0) all = FALLBACK_ZONES;
  const rest = all.filter((z) => z !== 'Africa/Cairo');
  if (!rest.includes('UTC')) rest.push('UTC');
  return ['Africa/Cairo', ...rest];
}

export const CURRENCY_OPTIONS: { code: string; name: string }[] = [
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'GBP', name: 'British pound' },
  { code: 'KWD', name: 'Kuwaiti dinar' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'BHD', name: 'Bahraini dinar' },
  { code: 'OMR', name: 'Omani rial' },
  { code: 'JOD', name: 'Jordanian dinar' },
  { code: 'LBP', name: 'Lebanese pound' },
  { code: 'IQD', name: 'Iraqi dinar' },
  { code: 'LYD', name: 'Libyan dinar' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'TND', name: 'Tunisian dinar' },
  { code: 'DZD', name: 'Algerian dinar' },
  { code: 'SDG', name: 'Sudanese pound' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'RUB', name: 'Russian ruble' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'KES', name: 'Kenyan shilling' },
];

/** The options for a currency dropdown; a current value that is not in the list (older company) is kept at the top. */
export function currencyChoices(current?: string): { code: string; name: string }[] {
  if (current && !CURRENCY_OPTIONS.some((c) => c.code === current)) return [{ code: current, name: current }, ...CURRENCY_OPTIONS];
  return CURRENCY_OPTIONS;
}
