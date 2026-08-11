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
