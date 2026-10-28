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

/** Thrown when a feature needs a secret or binding that this deployment does not have. Maps to 503. */
export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} isn't configured on this server`);
    this.name = 'NotConfiguredError';
  }
}
