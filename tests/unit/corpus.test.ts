// inspect on files saved by real applications (tests/corpus, licenses in tests/corpus/LICENSES.md).
// Each file has the expected result next to it as <file>.inspect.json; after a deliberate change,
// update them with `npx vitest run tests/unit/corpus.test.ts -u` and review the diff.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspect } from 'docvane';

const CORPUS = fileURLToPath(new URL('../corpus', import.meta.url));
const FOLDERS = ['libreoffice'];

describe.each(FOLDERS)('corpus %s', (folder) => {
  const files = readdirSync(join(CORPUS, folder)).filter((f) => /\.(docx|pptx|xlsx)$/.test(f));

  it('has files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', async (file) => {
    const result = inspect(readFileSync(join(CORPUS, folder, file)));
    const summary = {
      tags: result.tags.map((t) => `${t.raw} @ ${t.location.description ?? ''}, character ${String(t.location.character)}`),
      sections: result.sections,
      schema: result.schema,
      warnings: result.warnings,
    };
    await expect(`${JSON.stringify(summary, null, 2)}\n`).toMatchFileSnapshot(join(CORPUS, folder, `${file}.inspect.json`));
  });
});
