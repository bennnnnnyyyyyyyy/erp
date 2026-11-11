// Pure helpers for the dialog's focus handling (Modal.tsx), kept apart so they can be unit tested without a browser.

export const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

export type FocusCandidate = {
  tabIndex: number;
  disabled?: boolean;
  hidden?: boolean;
  type?: string;
};

/** True when an element can take part in the Tab order: not disabled, not hidden, not a hidden input, tabindex not negative. */
export function isTabbable(el: FocusCandidate): boolean {
  if (el.disabled || el.hidden) return false;
  if (el.type === 'hidden') return false;
  return el.tabIndex >= 0;
}

/** Where Tab or Shift+Tab should go from `activeIndex` among `count` tabbable items, or null to let the browser move focus normally. */
export function nextTrapIndex(count: number, activeIndex: number, shift: boolean): number | null {
  if (count === 0) return -1; // nothing to focus: keep focus on the dialog itself
  if (activeIndex === -1) return shift ? count - 1 : 0; // focus is outside the list (e.g. on the dialog): enter it
  if (!shift && activeIndex === count - 1) return 0;
  if (shift && activeIndex === 0) return count - 1;
  return null;
}

export function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      isTabbable({
        tabIndex: el.tabIndex,
        disabled: (el as HTMLButtonElement).disabled,
        hidden: !!el.hidden || el.closest('[hidden]') !== null,
        type: (el as HTMLInputElement).type,
      }),
  );
}
