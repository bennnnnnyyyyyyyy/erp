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
  org: { id: string; name: string; slug: string; defaultCurrency: string; timezone: string; dateFormat: string } | null;
  role: Role | null;
  permissions: string[];
  modules: string[];
};
