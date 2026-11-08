// Copied from DevXord/xlvane tests/helpers/expect-error.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes.
import { expect } from 'vitest';
import { TvError, type TvErrorCode } from '../../packages/tplvane/src/errors';

/** Runs `fn`, expects it to throw an TvError with `code`, and returns the error. */
export function expectDvError(fn: () => unknown, code: TvErrorCode, details?: Record<string, unknown>): TvError {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(TvError);
  const error = thrown as TvError;
  expect({ code: error.code, message: error.message }).toMatchObject({ code });
  if (details) expect(error.details).toMatchObject(details);
  expect(error.hint.length).toBeGreaterThan(0);
  return error;
}

/** Async variant of {@link expectDvError}. */
export async function expectDvErrorAsync(
  fn: () => Promise<unknown>,
  code: TvErrorCode,
  details?: Record<string, unknown>,
): Promise<TvError> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(TvError);
  const error = thrown as TvError;
  expect(error.code).toBe(code);
  if (details) expect(error.details).toMatchObject(details);
  return error;
}
