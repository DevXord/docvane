// Images in the CLI (D-051): files only inside the folder of the data file, and the network only
// with --fetch-images, with a size limit and no redirect to another host.
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preview } from 'tplvane';
import { png } from '../helpers/images';
import { exampleFolder, response, runCli } from '../helpers/cli';

function withLogo(dir: string, logo: unknown, file = 'data.json'): void {
  const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, file), JSON.stringify({ ...data, logo }));
}

describe('CLI images', () => {
  it('reads an image file next to the data file, also in a subfolder and as { data }', async () => {
    const dir = exampleFolder();
    mkdirSync(join(dir, 'img'), { recursive: true });
    writeFileSync(join(dir, 'img', 'logo.png'), png(30, 10));
    withLogo(dir, { data: 'img/logo.png', width: 2 });
    const run = await runCli(dir, ['render', 'offer.docx', 'data.json']);
    expect(run.code).toBe(0);
    expect(preview(readFileSync(join(dir, 'offer-filled.docx'))).parts[0]?.lines[0]).toBe('[object]');
  });

  it('refuses paths that leave the folder, absolute paths and links pointing out of it', async () => {
    const dir = exampleFolder();
    mkdirSync(join(dir, 'sub'), { recursive: true });
    symlinkSync(join(dir, 'logo.png'), join(dir, 'sub', 'link.png'));
    for (const logo of ['../logo.png', 'x/../../logo.png', join(dir, 'logo.png'), 'link.png']) {
      withLogo(dir, logo, join('sub', 'data.json'));
      const run = await runCli(dir, ['render', 'offer.docx', 'sub/data.json', '--dry-run', '--json']);
      expect(run.code, logo).toBe(3);
      expect(JSON.parse(run.stdout).error.code, logo).toBe('TV_E_INVALID_VALUE');
    }
  });

  it('does not touch the network without --fetch-images', async () => {
    const dir = exampleFolder();
    withLogo(dir, 'https://example.com/logo.png');
    const fetched: string[] = [];
    const render = await runCli(dir, ['render', 'offer.docx', 'data.json'], { fetched });
    expect(render.code).toBe(3);
    expect(render.stderr).toContain('--fetch-images');
    const validate = await runCli(dir, ['validate', 'offer.docx', 'data.json'], { fetched });
    expect(validate.code).toBe(0);
    expect(fetched).toEqual([]);
  });

  it('downloads with --fetch-images, follows redirects on the same host only, and limits the size', async () => {
    const dir = exampleFolder();
    withLogo(dir, 'https://example.com/logo.png');
    const fetched: string[] = [];
    const ok = await runCli(dir, ['render', 'offer.docx', 'data.json', '--fetch-images'], {
      fetched,
      fetch: (url) => (url === 'https://example.com/logo.png' ? response(302, new Uint8Array(0), { location: '/static/logo.png' }) : response(200, png(20, 20))),
    });
    expect(ok.code, ok.stderr).toBe(0);
    expect(fetched).toEqual(['https://example.com/logo.png', 'https://example.com/static/logo.png']);

    const away = await runCli(dir, ['render', 'offer.docx', 'data.json', '--fetch-images', '--force', '--json'], { fetch: () => response(302, new Uint8Array(0), { location: 'http://169.254.169.254/latest' }) });
    expect(JSON.parse(away.stdout).error).toMatchObject({ code: 'TV_E_IMAGE_FETCH' });
    expect(JSON.parse(away.stdout).error.message).toContain('example.com/logo.png');

    const big = await runCli(dir, ['render', 'offer.docx', 'data.json', '--fetch-images', '--force', '--json'], { fetch: () => response(200, new Uint8Array(10), { 'content-length': String(1e9) }) });
    expect(JSON.parse(big.stdout).error).toMatchObject({ code: 'TV_E_IMAGE_FETCH' });
  });
});
