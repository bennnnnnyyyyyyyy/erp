export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * True when the database says a table, column or function does not exist: the code was deployed before its migration was applied
 * (it happened three times; see the worklog for PRs #27 and #35). Postgres codes 42P01 (table), 42703 (column), 42883 (function);
 * PostgREST PGRST202 (function not in its cache), PGRST204 (column), PGRST205 (table). Answered as 503 "not set up yet", not 500.
 */
export function isMissingSchema(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code);
}

/** Thrown when a feature needs a secret or binding that this deployment does not have. Maps to 503. */
export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} isn't configured on this server`);
    this.name = 'NotConfiguredError';
  }
}
