// The product's own brand, in one place (Bellvox look, 23 Nov 2026). Change the name or the logo here only: the top bar, the browser tab
// and the sign-in pages read it from here. index.html carries the same name for the first paint; brand.test.ts checks that they match.
// A customer's own name and logo are not here: they come from the company's settings and show next to the product's (never instead).
export const BRAND = {
  /** The product's full name: browser tab, sign-in pages, the logo's alternative text. A brand name, so it is not translated. */
  name: 'Bellvox ERP',
  /** The word after the logo image in the top bar (the logo image itself says "Bellvox"). */
  suffix: 'ERP',
  /** The word mark (red on transparent), from bellvox.ai. */
  logo: '/brand/bellvox-logo.webp',
  /** The square mark, used where the word mark does not fit (phones) and as the browser icon. */
  mark: '/brand/favicon.svg',
} as const;
