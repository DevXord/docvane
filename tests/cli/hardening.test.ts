// Regression tests of the security review of the CLI image rules (D-061): each image file is read
// once and counted against maxImages, only regular files are read (no FIFO, device or folder), the
// size is checked before reading, and a download does not go from https to http.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDocx, p } from '../helpers/docx';
import { png } from '../helpers/images';
import { exampleFolder, response, runCli } from '../helpers/cli';
import { nodeIo, type CliIo } from '../../packages/docvane/src/cli/io';
import { main } from '../../packages/docvane/src/cli/main';

function loopTemplate(dir: string): void {
  writeFileSync(join(dir, 'loop.docx'), buildDocx({ body: p('{#items}') + p('{%img}') + p('{/items}') }));
}

describe('CLI image hardening', () => {
  it('reads an image named many times once', async () => {
    const dir = exampleFolder();
    loopTemplate(dir);
    writeFileSync(join(dir, 'a.png'), png(8, 8));
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ items: Array.from({ length: 200 }, () => ({ img: 'a.png' })) }));
    let reads = 0;
    const io: CliIo = { ...nodeIo(), cwd: dir, stdout: () => {}, stderr: () => {}, readRegularFile: (path, max) => (reads++, nodeIo().readRegularFile(path, max)) };
    expect(await main(['render', 'loop.docx', 'data.json', '--dry-run'], io)).toBe(0);
    expect(reads).toBe(1);
  });

  it('counts different image files against maxImages', async () => {
    const dir = exampleFolder();
    loopTemplate(dir);
    mkdirSync(join(dir, 'img'));
    const items = Array.from({ length: 1001 }, (_, i) => {
      writeFileSync(join(dir, 'img', `${String(i)}.png`), png(1, 1));
      return { img: `img/${String(i)}.png` };
    });
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ items }));
    const run = await runCli(dir, ['render', 'loop.docx', 'data.json', '--dry-run', '--json']);
    expect(JSON.parse(run.stdout).error).toMatchObject({ code: 'DV_E_LIMIT_EXCEEDED', details: { limit: 'maxImages' } });
  });

  it('refuses a FIFO without waiting, and a folder with a proper error', async () => {
    const dir = exampleFolder();
    loopTemplate(dir);
    expect(spawnSync('mkfifo', [join(dir, 'pipe.png')], { encoding: 'utf8' }).status).toBe(0);
    mkdirSync(join(dir, 'folder.png'));
    for (const img of ['pipe.png', 'folder.png']) {
      writeFileSync(join(dir, 'data.json'), JSON.stringify({ items: [{ img }] }));
      const started = Date.now();
      const run = await runCli(dir, ['render', 'loop.docx', 'data.json', '--dry-run', '--json']);
      expect(Date.now() - started, img).toBeLessThan(5000);
      expect(JSON.parse(run.stdout).error, img).toMatchObject({ code: 'DV_E_INVALID_VALUE' });
      expect(JSON.parse(run.stdout).error.message, img).toContain('is not a regular file');
    }
  });

  it('checks the size before reading', async () => {
    const dir = exampleFolder();
    loopTemplate(dir);
    writeFileSync(join(dir, 'big.png'), new Uint8Array(21 * 1024 * 1024));
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ items: [{ img: 'big.png' }] }));
    const run = await runCli(dir, ['render', 'loop.docx', 'data.json', '--dry-run', '--json']);
    expect(JSON.parse(run.stdout).error).toMatchObject({ code: 'DV_E_LIMIT_EXCEEDED', details: { limit: 'maxImageBytes' } });
  });

  it('does not follow a redirect from https to http', async () => {
    const dir = exampleFolder();
    const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ ...data, logo: 'https://example.com/logo.png' }));
    const fetched: string[] = [];
    const run = await runCli(dir, ['render', 'offer.docx', 'data.json', '--fetch-images', '--json'], { fetched, fetch: (url) => (url.startsWith('https:') ? response(302, new Uint8Array(0), { location: 'http://example.com/logo.png' }) : response(200, png(4, 4))) });
    expect(JSON.parse(run.stdout).error).toMatchObject({ code: 'DV_E_IMAGE_FETCH' });
    expect(fetched).toEqual(['https://example.com/logo.png']);
  });
});
