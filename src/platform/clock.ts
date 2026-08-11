/**
 * Time port.
 *
 * All application timestamps are UTC ISO-8601 text. Time-sensitive code accepts
 * a `Clock` so that tests are deterministic and `new Date()` is not scattered
 * through domain and application code.
 */

/** UTC ISO-8601 timestamp, for example `2026-08-11T09:30:00.000Z`. */
export type IsoTimestamp = string;

export interface Clock {
  now(): IsoTimestamp;
}

export const systemClock: Clock = {
  now: (): IsoTimestamp => new Date().toISOString(),
};

/** Minutes in one day, for interval arithmetic expressed in whole minutes. */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * `timestamp` moved forward by `minutes`, normalised to UTC ISO-8601 text.
 *
 * Pure and framework-free, so scheduling logic can compute a due date without
 * reading the real clock. Because every stored timestamp is UTC in this one
 * format, two of them can also be compared as strings.
 */
export function addMinutes(
  timestamp: IsoTimestamp,
  minutes: number,
): IsoTimestamp {
  const base = new Date(timestamp);

  if (Number.isNaN(base.getTime())) {
    throw new Error(`"${timestamp}" is not a valid UTC ISO-8601 timestamp.`);
  }

  return new Date(base.getTime() + minutes * 60_000).toISOString();
}
