// Kept apart from usePaged.ts so it can be tested without a browser.

/** The URL of one page: `path` plus offset, keeping any query the path already has. */
export function pageUrl(path: string, offset: number): string {
  if (offset === 0) return path;
  return `${path}${path.includes('?') ? '&' : '?'}offset=${offset}`;
}
