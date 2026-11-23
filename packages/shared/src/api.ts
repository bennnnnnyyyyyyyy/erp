// Every API response is one of these two shapes, and the HTTP status code agrees with `status`.
export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; status: number; error: string; code?: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number | null;
};

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

/** A company's work week (sql/106). Default: Sunday to Thursday, 09:00 to 17:00. */
export type WorkWeek = { days: number[]; start: string; end: string };
export const DEFAULT_WORK_WEEK: WorkWeek = { days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' };

export type SessionInfo = {
  userId: string;
  email: string;
  /** The person's display name, read from the database on every session load (same source as every screen), or null if none is set. */
  name?: string | null;
  org: {
    id: string;
    name: string;
    slug: string;
    defaultCurrency: string;
    timezone: string;
    dateFormat: string;
    language: 'en' | 'ar';
    showTutorial: boolean;
    showTour: boolean;
    /** Blind stock counts (sql/066). */
    blindCounts: boolean;
    /** Owners may approve their own requests, each flagged self-approved (sql/077, decision D1c). Optional until every API sends it. */
    ownerSelfApproval?: boolean;
    /** The company's work week (sql/106): workdays 0 = Sunday .. 6, start and end time "HH:MM". Optional until every API sends it. */
    workWeek?: WorkWeek;
  } | null;
  /** The person's own saved language (sql/038), or null to follow the company default. Same in every company they belong to. */
  userLanguage: 'en' | 'ar' | null;
  /** True once the person has been asked about language (a saved row exists, even if they chose the company default), so they are asked only once. */
  userLanguageAsked: boolean;
  role: Role | null;
  permissions: string[];
  /**
   * The person may approve or reject their own requests: the only active owner or admin (D1), or an owner while "owners may approve
   * their own" is on (D1c); the rule of core__sole_approver (sql/063, 077). Screens hide Approve on one's own request otherwise.
   * Optional until every API sends it.
   */
  mayApproveOwn?: boolean;
  modules: string[];
};
