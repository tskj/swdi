type Reporter = (kind: string, message: string) => void;

let reporter: Reporter = () => {};

/** Wire invariant violations into the host environment's operator sink (server report(), console, ...). */
export function setAssertReporter(fn: Reporter) {
  reporter = fn;
}

/** Narrow away null/undefined, or throw. The checked alternative to a `!` assertion. */
export function ensure<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) fail(message);

  return value;
}

/** Hard invariant break. Returns never, so it composes inside expressions: `x ?? fail("...")`. */
export function fail(message: string): never {
  reporter("invariant.fail", message);
  throw new Error(`invariant failed: ${message}`);
}

/** Exhaustiveness for discriminated-union switch defaults; the compiler errors if a case is missing. */
export function unreachable(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
