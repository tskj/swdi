// All wall-clock reads route through here so tests can drive a synthetic clock.
// This file is the one legitimate home of Date.now() in the codebase.

type Clock = { nowMs(): number };

const systemClock: Clock = { nowMs: () => Date.now() };

let clock: Clock = systemClock;

export function nowMs(): number  { return clock.nowMs(); }
export function nowDate(): Date  { return new Date(clock.nowMs()); }
export function nowIso(): string { return nowDate().toISOString(); }

export function setClockForTests(next: Clock | null) {
  clock = next ?? systemClock;
}

export async function withClock<T>(next: Clock, fn: () => Promise<T> | T): Promise<T> {
  const prev = clock;

  clock = next;
  try     { return await fn(); }
  finally { clock = prev; }
}
