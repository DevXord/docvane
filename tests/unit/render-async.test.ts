// renderAsync and the SSRF guarantee: tplvane never connects anywhere by itself; images given as
// addresses are fetched only through the function the caller passes.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, renderAsync } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { png } from '../helpers/images';
import { partXml, zipNames } from '../helpers/read-docx';

const SRC = fileURLToPath(new URL('../../packages/tplvane/src', import.meta.url));
const template = (): Uint8Array => buildDocx({ body: p('{#items}{%img}{/items}') });
const internal = { items: [{ img: 'http://169.254.169.254/latest/meta-data/' }, { img: 'http://localhost:8080/admin.png' }, { img: 'https://[::1]/x.png' }] };

async function expectAsyncError(promise: Promise<unknown>, code: string): Promise<{ code: string; errors: readonly { code: string }[] }> {
  try {
    await promise;
  } catch (error) {
    expect((error as { code: string }).code).toBe(code);
    return error as { code: string; errors: readonly { code: string }[] };
  }
  throw new Error(`expected ${code}`);
}

describe('SSRF', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes no connection for addresses in the data when no fetchImage is given', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network used')));
    const xhr = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('WebSocket', xhr);
    const error = expectDvError(() => render(template(), internal), 'TV_E_DATA_INVALID');
    expect(error.errors.map((e) => e.code)).toEqual(['TV_E_INVALID_VALUE', 'TV_E_INVALID_VALUE', 'TV_E_INVALID_VALUE']);
    expect(error.errors[0]?.hint).toMatch(/fetchImage/);
    const asyncError = await expectAsyncError(renderAsync(template(), internal), 'TV_E_DATA_INVALID');
    expect(asyncError.errors).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it('the sources have no way to connect: no fetch, XMLHttpRequest, WebSocket, Node.js network modules or dynamic import', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));
    const CLI = join(SRC, 'cli');
    // The command line (src/cli) may use Node.js files and paths; only its I/O module reaches fetch,
    // and only with --fetch-images is it called (tests/cli/images.test.ts). The library uses neither.
    const FETCH_ALLOWED = [join(CLI, 'io.ts'), join(CLI, 'images.ts')];
    for (const file of files(SRC)) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/XMLHttpRequest|WebSocket|node:(?:net|http|https|dns|tls|dgram|http2|child_process|worker_threads)|import\s*\(/);
      if (!file.startsWith(CLI)) expect(code, file).not.toMatch(/\bfetch\s*\(|from 'node:/);
      else if (!FETCH_ALLOWED.includes(file)) expect(code, file).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

describe('renderAsync', () => {
  it('fetches each distinct address once through fetchImage and inserts the images', async () => {
    const fetchImage = vi.fn((url: string) => Promise.resolve(url.endsWith("a.png") ? png(10, 10) : (png(20, 10).buffer as ArrayBuffer)));
    const data = { items: [{ img: 'https://cdn.example.com/a.png' }, { img: 'https://cdn.example.com/a.png' }, { img: 'https://cdn.example.com/b.png' }] };
    const bytes = await renderAsync(template(), data, { fetchImage });
    expect(fetchImage.mock.calls.map((c) => c[0])).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']);
    expect(zipNames(bytes).filter((n) => n.startsWith('word/media/'))).toHaveLength(2);
    expect(partXml(bytes).match(/<w:drawing>/g)).toHaveLength(3);
  });

  it('reports a failing fetchImage with the address and checks what it returns', async () => {
    const failing = await expectAsyncError(renderAsync(template(), { items: [{ img: 'https://x.org/a.png' }] }, { fetchImage: () => Promise.reject(new Error('404')) }), 'TV_E_IMAGE_FETCH');
    expect(failing).toMatchObject({ details: { url: 'https://x.org/a.png' } });
    await expectAsyncError(renderAsync(template(), { items: [{ img: 'https://x.org/a.png' }] }, { fetchImage: () => Promise.resolve('nope' as never) }), 'TV_E_IMAGE_FETCH');
    const notImage = await expectAsyncError(renderAsync(template(), { items: [{ img: 'https://x.org/a.png' }] }, { fetchImage: () => Promise.resolve(new TextEncoder().encode('<html>')) }), 'TV_E_DATA_INVALID');
    expect(notImage.errors[0]?.code).toBe('TV_E_INVALID_VALUE');
  });

  it('works like render without image addresses, and limits the number of fetches', async () => {
    expect(await renderAsync(buildDocx({ body: p('{a}') }), { a: 1 })).toBeInstanceOf(Uint8Array);
    await expectAsyncError(renderAsync(template(), { items: [{ img: 'https://x/1' }, { img: 'https://x/2' }] }, { fetchImage: () => Promise.resolve(png(1, 1)), limits: { maxImages: 1 } }), 'TV_E_LIMIT_EXCEEDED');
    await expectAsyncError(renderAsync(template(), { items: [] }, { fetchImage: 'x' as never }), 'TV_E_INVALID_OPTION');
  });
});
