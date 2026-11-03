// Exact decimal arithmetic for ETA documents. ETA works to 5 decimal places and validates our totals with its own
// equations (documentation/plans/ETA_EINVOICING_PLAN.md section 7), so every amount here is a bigint count of 1e-5 units.
// No floating point anywhere. One rounding rule everywhere: half away from zero, at 5 decimals, after each equation.

export const DEC_PLACES = 5;
export const DEC_SCALE = 100000n;

/** A decimal number as an integer count of 1e-5 units. */
export type Dec = bigint;

const DEC_RE = /^(-?)(\d+)(?:\.(\d{1,5}))?$/;

export function parseDec(text: string): Dec {
  const m = DEC_RE.exec(text.trim());
  if (!m) throw new Error(`INVALID_DECIMAL: "${text}" (digits with at most ${DEC_PLACES} decimals)`);
  const whole = BigInt(m[2] as string) * DEC_SCALE;
  const frac = BigInt(((m[3] ?? '') + '00000').slice(0, DEC_PLACES));
  const v = whole + frac;
  return m[1] === '-' ? -v : v;
}

/** Divide with half-away-from-zero rounding. `d` must be positive. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error('divRound: divisor must be positive');
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  return neg ? -q : q;
}

/** a * b where both are Dec; result is a Dec rounded to 5 places. */
export function mul(a: Dec, b: Dec): Dec {
  return divRound(a * b, DEC_SCALE);
}

/** base * (ratePercent / 100); ratePercent is a Dec holding a percentage (14 means 14%). */
export function pct(base: Dec, ratePercent: Dec): Dec {
  return divRound(base * ratePercent, DEC_SCALE * 100n);
}

/**
 * Canonical text for an amount: at least 2 decimals, trailing zeros beyond the second removed, at most 5.
 * Deterministic on purpose: the text we sign is the exact text we send (see serialize.ts).
 */
export function fmtDec(v: Dec): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / DEC_SCALE;
  let frac = (a % DEC_SCALE).toString().padStart(DEC_PLACES, '0');
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${neg && a !== 0n ? '-' : ''}${whole}.${frac}`;
}

/** Round a Dec to places decimals (0 to 5), half away from zero. */
export function roundTo(v: Dec, places: number): Dec {
  if (!Number.isInteger(places) || places < 0 || places > DEC_PLACES) throw new Error('INVALID_PLACES');
  const unit = 10n ** BigInt(DEC_PLACES - places);
  return divRound(v, unit) * unit;
}

/** Convert integer minor units (2 decimals, e.g. piastres) to a Dec. */
export function fromMinor2(minor: bigint | number): Dec {
  return BigInt(minor) * 1000n;
}

/** Convert a Dec to integer minor units (2 decimals), rounding half away from zero. */
export function toMinor2(v: Dec): bigint {
  return divRound(v, 1000n);
}

export const ZERO: Dec = 0n;
