import type { HTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../lib/router';

// A table row that opens a record when clicked anywhere on it. The record's number in the row should still be a <Link> to the same
// place: that is what keyboard and screen-reader users reach, and what a middle-click or Ctrl-click opens in a new tab. Clicks on
// anything interactive inside the row (a link, a Void button, an input) are left alone, and so is a drag that selects text.

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"]';

export function ClickRow({ to, className, onClick, ...rest }: HTMLAttributes<HTMLTableRowElement> & { to: string }) {
  function handle(e: MouseEvent<HTMLTableRowElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0) return;
    if ((e.target as Element).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(to, '_blank', 'noopener');
      return;
    }
    navigate(to);
  }
  return <tr className={className ? `row-link ${className}` : 'row-link'} onClick={handle} {...rest} />;
}
