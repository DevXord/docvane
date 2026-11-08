// Copied from DevXord/xlvane tests/unit/limits.test.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes. Spreadsheet limits replaced by
// template limits.
import { describe, expect, it } from 'vitest';
import { TvError } from '../../packages/tplvane/src/errors';
import { DEFAULT_LIMITS, resolveLimits } from '../../packages/tplvane/src/limits';

function invalidOption(fn: () => unknown): TvError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('TV_E_INVALID_OPTION');
    return error as TvError;
  }
  throw new Error('expected TV_E_INVALID_OPTION');
}

describe('resolveLimits', () => {
  it('returns a copy of the defaults when no limits are given', () => {
    const limits = resolveLimits(undefined);
    expect(limits).toEqual(DEFAULT_LIMITS);
    expect(limits).not.toBe(DEFAULT_LIMITS);
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });

  it('overrides only the given limits', () => {
    const limits = resolveLimits({ maxEntries: 5, maxCompressionRatio: 50.5 });
    expect(limits.maxEntries).toBe(5);
    expect(limits.maxCompressionRatio).toBe(50.5);
    expect(limits.maxTags).toBe(DEFAULT_LIMITS.maxTags);
  });

  it('accepts Infinity to switch a limit off', () => {
    expect(resolveLimits({ maxTags: Number.POSITIVE_INFINITY }).maxTags).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects unknown keys and suggests the closest one', () => {
    const error = invalidOption(() => resolveLimits({ maxEntrys: 5 }));
    expect(error.message).toContain('maxEntrys');
    expect(error.hint).toContain('maxEntries');
  });

  it.each([[0], [-1], [1.5], [Number.NaN], ['10'], [null]])('rejects %s as a count limit', (value) => {
    invalidOption(() => resolveLimits({ maxEntries: value }));
  });

  it('rejects a compression ratio below 1', () => {
    invalidOption(() => resolveLimits({ maxCompressionRatio: 0.5 }));
  });

  it('rejects limits that are not an object', () => {
    invalidOption(() => resolveLimits(5));
    invalidOption(() => resolveLimits([]));
  });

  it('treats a "__proto__" key as an unknown option and leaves prototypes alone', () => {
    const hostile = JSON.parse('{"__proto__": {"maxEntries": 1, "polluted": true}}') as unknown;
    invalidOption(() => resolveLimits(hostile));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(resolveLimits(undefined).maxEntries).toBe(DEFAULT_LIMITS.maxEntries);
  });

  it('ignores inherited properties', () => {
    const inherited = Object.create({ maxEntries: 1 }) as object;
    expect(resolveLimits(inherited).maxEntries).toBe(DEFAULT_LIMITS.maxEntries);
  });
});
