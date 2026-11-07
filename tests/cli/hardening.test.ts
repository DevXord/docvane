// Regression tests of the security review of the CLI image rules (D-061): each image file is read
// once and counted against maxImages, only regular files are read (no FIFO, device or folder), the
// size is checked before reading, and a download does not go from https to http.
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('counts loop repetitions while it looks for image files, so nested lists fail fast (review 3)', async () => {
    const dir = exampleFolder();
    writeFileSync(join(dir, 'nested.docx'), buildDocx({ body: p('{#a}{#b}{#c}{#d}{#e}{%logo}{/e}{/d}{/c}{/b}{/a}') }));
    const list = Array.from({ length: 100 }, () => ({}));
    writeFileSync(join(dir, 'nested.json'), JSON.stringify({ a: list, b: list, c: list, d: list, e: list, logo: 'logo.png' }));
    const started = Date.now();
    const result = await runCli(dir, ['validate', 'nested.docx', 'nested.json', '--json']);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'DV_E_LIMIT_EXCEEDED' } });
  });

  it('does not write through a link with --force, and refuses -o - (review 3)', async () => {
    const dir = exampleFolder();
    writeFileSync(join(dir, 'victim.txt'), 'keep me');
    symlinkSync(join(dir, 'victim.txt'), join(dir, 'offer-filled.docx'));
    const result = await runCli(dir, ['render', 'offer.docx', 'data.json', '--force', '--json']);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'DV_E_FILE_WRITE', details: { reason: 'ELINK' } } });
    expect(readFileSync(join(dir, 'victim.txt'), 'utf8')).toBe('keep me');
    expect((await runCli(dir, ['render', 'offer.docx', 'data.json', '-o', '-'])).code).toBe(2);
  });

  it('replaces an existing output with --force by renaming a new file over it (review 3)', async () => {
    const dir = exampleFolder();
    writeFileSync(join(dir, 'offer-filled.docx'), 'old');
    expect((await runCli(dir, ['render', 'offer.docx', 'data.json', '--force'])).code).toBe(0);
    expect(readFileSync(join(dir, 'offer-filled.docx')).length).toBeGreaterThan(1000);
    expect(readdirSync(dir).filter((n) => n.includes('.docvane-'))).toEqual([]);
  });

  it('writes control characters of the Try line as escapes, and refuses devices as input (review 3)', async () => {
    const dir = exampleFolder();
    const evil = 'evil\u001b]0;PWNED\u0007.docx';
    writeFileSync(join(dir, evil), readFileSync(join(dir, 'offer.docx')));
    writeFileSync(join(dir, 'offer-filled.docx'), 'x');
    const result = await runCli(dir, ['render', evil, 'data.json', '-o', 'offer-filled.docx']);
    expect(result.stderr).toContain('Try:');
    expect(result.stderr).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    const device = await runCli(dir, ['inspect', '/dev/zero', '--json']);
    expect(device.code).toBe(3);
    expect(JSON.parse(device.stdout)).toMatchObject({ ok: false, error: { code: 'DV_E_FILE_READ' } });
  });

  it('prints help as text also with --json, and treats arguments after -- as files (review 3)', async () => {
    const dir = exampleFolder();
    expect((await runCli(dir, ['--help', '--json'])).code).toBe(0);
    expect((await runCli(dir, ['help', '--json'])).code).toBe(0);
    const after = await runCli(dir, ['inspect', '--', '--json']);
    expect(after.stdout.startsWith('{')).toBe(false);
  });
});
