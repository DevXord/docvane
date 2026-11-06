// render on templates saved by LibreOffice (tests/corpus): each <file>.docx with <file>.data.json
// next to it is rendered, and the text of the result is compared with <file>.render.txt.
// After a deliberate change, update with `npx vitest run tests/unit/render-corpus.test.ts -u`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspect, render } from 'docvane';
import { storyTexts } from '../helpers/read-docx';
import { slideTexts } from '../helpers/read-pptx';

const CORPUS = fileURLToPath(new URL('../corpus', import.meta.url));
const FOLDERS = ['libreoffice'];

describe.each(FOLDERS)('render corpus %s', (folder) => {
  const dir = join(CORPUS, folder);
  const files = readdirSync(dir).filter((f) => /\.(docx|pptx)$/.test(f) && readdirSync(dir).includes(f.replace(/\.(docx|pptx)$/, '.data.json')));

  it('has templates with data', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', async (file) => {
    const data = JSON.parse(readFileSync(join(dir, file.replace(/\.(docx|pptx)$/, '.data.json')), 'utf8')) as unknown;
    const result = render(readFileSync(join(dir, file)), data, { locale: 'en-US' });
    // The result has no tags left and can be read again.
    expect(inspect(result).tags).toEqual([]);
    const text = file.endsWith('.pptx')
      ? slideTexts(result)
          .map((s, i) => `== slide ${String(i + 1)}\n${s.slide.join('\n')}${s.notes.length > 0 ? `\n-- notes\n${s.notes.join('\n')}` : ''}`)
          .join('\n')
      : Object.entries(storyTexts(result))
          .map(([part, paragraphs]) => `== ${part}\n${paragraphs.join('\n')}`)
          .join('\n');
    await expect(`${text}\n`).toMatchFileSnapshot(join(dir, `${file}.render.txt`));
  });
});
