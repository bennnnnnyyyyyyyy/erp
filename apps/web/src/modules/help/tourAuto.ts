// When the guided tour starts by itself (decision R2 A, 10 Nov 2026). The company's "Guided tour for new staff" switch
// (organizations.settings.show_tour, off by default) turns it on for people who have not seen it; each person sees it once, remembered in
// this browser per person and company. The owner who switches it on has just seen the setting, so they are marked as having seen it and
// are not forced through the tour. The "Take the tour" button always works, whatever this says.

export const tourSeenKey = (userId: string, orgId: string) => `erp.tour.seen.${userId}.${orgId}`;

export function tourSeen(userId: string, orgId: string, storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(tourSeenKey(userId, orgId)) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(userId: string, orgId: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(tourSeenKey(userId, orgId), '1');
  } catch {
    /* storage blocked: the tour may show again next time, which is harmless */
  }
}

/**
 * Should the tour start now, without the person pressing anything? Only when the company switched it on, this person has not seen it, they
 * have at least one step they can use, they are signed in to a real company, and they are not in the middle of the first-run setup wizard
 * (the wizard ends with its own tour button). Never in the sample build.
 */
export function shouldAutoStartTour(a: { showTour: boolean; userId: string | null; orgId: string | null; seen: boolean; stepCount: number; onSetupWizard: boolean; demo: boolean }): boolean {
  return a.showTour && !a.demo && !!a.userId && !!a.orgId && !a.seen && a.stepCount > 0 && !a.onSetupWizard;
}
