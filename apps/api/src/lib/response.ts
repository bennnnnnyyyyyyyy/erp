import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiFailure, ApiSuccess } from '@ggo/shared';

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json<ApiSuccess<T>>({ success: true, data }, status);
}

export function fail(c: Context, status: ContentfulStatusCode, error: string, code?: string) {
  const body: ApiFailure = { success: false, status, error };
  if (code) body.code = code;
  return c.json(body, status);
}
