// Images for the CLI (D-051). JSON cannot hold bytes, so a value of an image tag can be a path of
// a file relative to the folder of the data file; it is read and turned into a data URL before
// rendering. The file must stay inside that folder: absolute paths, ".." that leaves it and links
// that point out of it are refused. Images given as http(s) addresses are downloaded only with
// --fetch-images, with a size and time limit and without redirects to another host.
import { isAbsolute, resolve, sep } from 'node:path';
import { DvError } from '../errors';
import { ownValue } from '../expr/evaluate';
import type { Limits } from '../limits';
import type { InspectResult, SectionNode, TagInfo } from '../model';
import { clip } from '../util/clip';
import type { CliIo, FetchFunction } from './io';

const isAddress = (s: string): boolean => /^(data:|https?:)/i.test(s);

function mimeOf(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Reads an image file given relative to `dir` and returns it as a data URL. */
function readImage(io: CliIo, dir: string, path: string, tag: TagInfo, limits: Limits): string {
  const fail = (code: 'DV_E_INVALID_VALUE' | 'DV_E_FILE_READ', message: string, hint: string): DvError => new DvError(code, message, { location: tag.location, hint, details: { path: clip(path), tag: clip(tag.raw) } });
  if (path === '' || isAbsolute(path) || path.includes('\0')) {
    throw fail('DV_E_INVALID_VALUE', `The image "${clip(path)}" for ${clip(tag.raw)} is not a path relative to the folder of the data file.`, 'Give image files by their path relative to the folder of the data file, such as "images/logo.png", or as a data URL.');
  }
  let real: string;
  let root: string;
  try {
    root = io.realpath(dir);
    real = io.realpath(resolve(dir, path));
  } catch {
    throw fail('DV_E_FILE_READ', `The image file "${clip(path)}" for ${clip(tag.raw)} was not found next to the data file.`, `Check the path; it is relative to the folder of the data file (${clip(dir)}).`);
  }
  if (real !== root && !real.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw fail('DV_E_INVALID_VALUE', `The image file "${clip(path)}" for ${clip(tag.raw)} is outside the folder of the data file.`, 'Put the image in the folder of the data file or below it. Paths that leave it, and links that point out of it, are refused so that data cannot read other files.');
  }
  const bytes = io.readFile(real);
  if (bytes.length > limits.maxImageBytes) {
    throw new DvError('DV_E_LIMIT_EXCEEDED', `The image file "${clip(path)}" has more than ${String(limits.maxImageBytes)} bytes.`, { location: tag.location, hint: 'Use a smaller image.', details: { limit: 'maxImageBytes', value: limits.maxImageBytes } });
  }
  const mime = mimeOf(bytes);
  if (mime === null) throw fail('DV_E_INVALID_VALUE', `The file "${clip(path)}" for ${clip(tag.raw)} is not a PNG, JPEG or GIF image.`, 'Pass a PNG, JPEG or GIF file.');
  return `data:${mime};base64,${base64(bytes)}`;
}

/** The innermost scope that holds `first` as an own data field, as render looks names up. */
function holderOf(scopes: readonly unknown[], first: string): unknown {
  for (let i = scopes.length - 1; i >= 0; i--) if (ownValue(scopes[i], first) !== undefined) return scopes[i];
  return undefined;
}

function lookup(scopes: readonly unknown[], segments: readonly string[]): unknown {
  if (segments.length === 0) return scopes[scopes.length - 1];
  let value = ownValue(holderOf(scopes, segments[0] as string), segments[0] as string);
  for (const s of segments.slice(1)) value = ownValue(value, s);
  return value;
}

const plainPath = (tag: TagInfo): string[] | null => (tag.formatters.length === 0 && tag.paths.length === 1 && tag.paths[0] === tag.path ? (tag.path === '.' ? [] : tag.path.split('.')) : null);

/**
 * Replaces the image files named in `data` by data URLs, following the sections of the template
 * as render does. `data` is changed in place (the CLI parsed it from JSON). Addresses and data URLs
 * are left as they are.
 */
export function resolveImageFiles(io: CliIo, data: unknown, inspected: InspectResult, dir: string, limits: Limits, allowAddresses: boolean): void {
  const address = (value: string, tag: TagInfo): void => {
    if (allowAddresses || !/^https?:/i.test(value)) return;
    throw new DvError('DV_E_INVALID_VALUE', `The image "${clip(value)}" for ${clip(tag.raw)} is an address, and docvane downloads images only when you allow it.`, {
      location: tag.location,
      hint: 'Add --fetch-images to download images given as http(s) addresses, or give the image as a file next to the data file.',
      details: { path: clip(value), tag: clip(tag.raw), address: true },
    });
  };
  const inSections = new Set<TagInfo>();
  const mark = (s: SectionNode): void => {
    for (const t of s.tags) inSections.add(t);
    for (const c of s.sections) mark(c);
  };
  for (const s of inspected.sections) mark(s);
  const visit = (tags: readonly TagInfo[], sections: readonly SectionNode[], scopes: readonly unknown[]): void => {
    for (const tag of tags) {
      if (tag.kind !== 'image') continue;
      const segments = plainPath(tag);
      if (segments === null) continue;
      const value = lookup(scopes, segments);
      // The object that holds the value, and the key, to replace it there.
      const holder = segments.length === 0 ? null : segments.length === 1 ? holderOf(scopes, segments[0] as string) : lookup(scopes, segments.slice(0, -1));
      const key = segments[segments.length - 1];
      if (typeof value === 'string') address(value, tag);
      else if (value !== null && typeof value === 'object' && typeof ownValue(value, 'data') === 'string') address(ownValue(value, 'data') as string, tag);
      if (typeof value === 'string' && !isAddress(value)) {
        if (holder !== null && typeof holder === 'object' && key !== undefined) (holder as Record<string, unknown>)[key] = readImage(io, dir, value, tag, limits);
      } else if (value !== null && typeof value === 'object') {
        const inner = ownValue(value, 'data');
        if (typeof inner === 'string' && !isAddress(inner)) (value as Record<string, unknown>)['data'] = readImage(io, dir, inner, tag, limits);
      }
    }
    for (const section of sections) {
      const segments = section.formatters.length === 0 && section.open.paths.length === 1 && section.open.paths[0] === section.path ? section.path.split('.') : null;
      const value = segments === null ? undefined : lookup(scopes, segments);
      const repeats: (readonly unknown[])[] =
        section.kind === 'inverted' || segments === null ? [scopes] : Array.isArray(value) ? value.map((item) => [...scopes, item]) : value !== undefined && value !== null && value !== false ? [[...scopes, value]] : [];
      for (const inner of repeats) visit(section.tags, section.sections, inner);
    }
  };
  visit(
    inspected.tags.filter((t) => !inSections.has(t)),
    inspected.sections,
    [data],
  );
}

/** Downloads an image for renderAsync: http(s) only, at most `maxBytes`, within 30 seconds, redirects only to the same host. */
export function imageFetcher(fetch: FetchFunction, maxBytes: number): (url: string) => Promise<Uint8Array> {
  return async (url: string): Promise<Uint8Array> => {
    let current = new URL(url);
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new Error(`only http and https addresses are downloaded, not ${current.protocol}`);
    const host = current.host;
    const signal = AbortSignal.timeout(30_000);
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(current.href, { redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null || redirects >= 5) throw new Error(`too many or empty redirects (HTTP ${String(response.status)})`);
        const next = new URL(location, current);
        if (next.host !== host) throw new Error(`the address redirects to another host (${next.host})`);
        current = next;
        continue;
      }
      if (response.status !== 200 || response.body === null) throw new Error(`HTTP ${String(response.status)}`);
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > maxBytes) throw new Error(`the image has ${String(declared)} bytes, more than ${String(maxBytes)}`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error(`the image has more than ${String(maxBytes)} bytes`);
        }
        chunks.push(value);
      }
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    }
  };
}
