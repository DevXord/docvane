// Copied from DevXord/xlvane tests/helpers/expect-error.ts, at aeaefbc, adapted for
// docvane (D-009): imports, DvError and DV_E_* codes.
import { expect } from 'vitest';
import { DvError, type DvErrorCode } from '../../packages/docvane/src/errors';

/** Runs `fn`, expects it to throw an DvError with `code`, and returns the error. */
export function expectDvError(fn: () => unknown, code: DvErrorCode, details?: Record<string, unknown>): DvError {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(DvError);
  const error = thrown as DvError;
  expect({ code: error.code, message: error.message }).toMatchObject({ code });
  if (details) expect(error.details).toMatchObject(details);
  expect(error.hint.length).toBeGreaterThan(0);
  return error;
}

/** Async variant of {@link expectDvError}. */
export async function expectDvErrorAsync(
  fn: () => Promise<unknown>,
  code: DvErrorCode,
  details?: Record<string, unknown>,
): Promise<DvError> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(DvError);
  const error = thrown as DvError;
  expect(error.code).toBe(code);
  if (details) expect(error.details).toMatchObject(details);
  return error;
}
