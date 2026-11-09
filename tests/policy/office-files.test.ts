// The repository holds no Office files (D-084): no documents, presentations or workbooks, and none
// of the flat ODF sources they were saved from. Templates for tests and examples are built in code
// (tests/helpers, scripts/lib/fixtures.mjs). The corpus of files saved by real applications is kept
// by the maintainer outside Git; only its list of licenses is tracked, and tests that need the
// files skip when they are not there.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tracked = (): string[] => spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const OFFICE = /\.(docx|docm|dotx|dotm|doc|pptx|pptm|potx|ppt|xlsx|xlsm|xltx|xls|odt|odp|ods|fodt|fodp|fods)$/i;

describe('Office files', () => {
  it('are not tracked by Git', () => {
    expect(tracked().filter((f) => OFFICE.test(f))).toEqual([]);
  });

  it('the corpus folder tracks only its list of licenses', () => {
    expect(tracked().filter((f) => f.startsWith('tests/corpus/'))).toEqual(['tests/corpus/LICENSES.md']);
  });

  it('.gitignore keeps the corpus and the generated example out', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    for (const line of ['tests/corpus/*', '!tests/corpus/LICENSES.md', 'examples/offer/offer.docx', 'bench/agents/files/broken.docx']) expect(ignore, line).toContain(line);
  });
});
