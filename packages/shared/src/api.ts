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

export type SessionInfo = {
  userId: string;
  email: string;
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
  } | null;
  /** The person's own saved language (sql/038), or null to follow the company default. Same in every company they belong to. */
  userLanguage: 'en' | 'ar' | null;
  /** True once the person has been asked about language (a saved row exists, even if they chose the company default), so they are asked only once. */
  userLanguageAsked: boolean;
  role: Role | null;
  permissions: string[];
  modules: string[];
};
