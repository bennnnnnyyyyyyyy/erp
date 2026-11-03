import { hasPermission } from '@erp/shared';

// The guided tour: which screens it visits, what it highlights there, and who sees each step. Words live in tourContent.ts (per language);
// this file holds nothing a translator touches. Plan: documentation/plans/IN_APP_TOUR_PLAN.md.

export type TourStep = {
  id: string;
  /** The real screen this step is about. The tour navigates there. */
  route: string;
  /** What to highlight, tried in order; the first that is on the page and has a size wins. The last should be a heading. */
  selectors: string[];
  /** The person needs this permission, and this module switched on, or the step is skipped for them. */
  permission?: string;
  module?: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'home', route: '/', selectors: ['[data-tour="home-summary"]', 'main h1', 'h1'], permission: 'finance.reports.view', module: 'finance' },
  { id: 'new-request', route: '/inventory/requests/new', selectors: ['section.page form', 'section.page h1'], permission: 'inventory.request.create', module: 'inventory' },
  { id: 'approve', route: '/inventory/requests', selectors: ['section.page .table-wrap', 'section.page table', 'section.page h1'], permission: 'inventory.items.read', module: 'inventory' },
  { id: 'ledger', route: '/inventory/ledger', selectors: ['section.page .table-wrap', 'section.page table', 'section.page h1'], permission: 'inventory.items.read', module: 'inventory' },
  { id: 'audit', route: '/settings/audit', selectors: ['section.page .table-wrap', 'section.page table', 'section.page h1'], permission: 'core.audit.read' },
  { id: 'alerts', route: '/alerts', selectors: ['section.page .table-wrap', 'section.page table', 'section.page h1'], permission: 'alerts.rules.view', module: 'alerts' },
  { id: 'guide', route: '/guide', selectors: ['section.page h1'] },
];

/** The steps this person can use. A step they cannot use is left out, so a viewer gets a shorter tour than an admin, never a broken one. */
export function stepsFor(session: { permissions: readonly string[]; modules: readonly string[] }): TourStep[] {
  return TOUR_STEPS.filter((s) => (!s.permission || hasPermission(session.permissions as string[], s.permission)) && (!s.module || session.modules.includes(s.module)));
}

export type Box = { top: number; left: number; width: number; height: number };

/**
 * Where to put the tooltip so it is fully on screen. Below the target when there is room, otherwise above, otherwise beside it (on the
 * side with room, so it does not cover what it points at), otherwise pinned to the bottom of the viewport. Below and above are centred on
 * the target and clamped to the viewport; beside takes whichever side has room. It works the same in left-to-right and right-to-left
 * layouts because it only looks at where the target actually is on screen.
 */
export function placeTooltip(
  target: Box,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  margin = 8,
): { top: number; left: number; placement: 'below' | 'above' | 'beside' | 'pinned' } {
  const centred = target.left + target.width / 2 - tip.width / 2;
  const left = Math.max(margin, Math.min(centred, viewport.width - tip.width - margin));
  const below = target.top + target.height + gap;
  if (below + tip.height + margin <= viewport.height) return { top: below, left, placement: 'below' };
  const above = target.top - gap - tip.height;
  if (above >= margin) return { top: above, left, placement: 'above' };
  // Beside: whichever side has room for the whole tooltip, top-aligned with the target and kept on screen.
  const top = Math.max(margin, Math.min(target.top, viewport.height - tip.height - margin));
  const roomStart = target.left - gap - margin;
  const roomEnd = viewport.width - (target.left + target.width) - gap - margin;
  if (roomStart >= tip.width && roomStart >= roomEnd) return { top, left: target.left - gap - tip.width, placement: 'beside' };
  if (roomEnd >= tip.width) return { top, left: target.left + target.width + gap, placement: 'beside' };
  if (roomStart >= tip.width) return { top, left: target.left - gap - tip.width, placement: 'beside' };
  return { top: Math.max(margin, viewport.height - tip.height - margin), left, placement: 'pinned' };
}
