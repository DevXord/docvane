// What the command line reaches outside itself: output, input, the environment, files and the
// network. `main` takes it as a parameter, so that tests run the CLI in memory; `nodeIo` gives
// the real process. Only the CLI (this folder) uses Node.js modules; the library does not.
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import process from 'node:process';

/** The answer of a fetch, as far as the CLI reads it. */
export interface FetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}

export type FetchFunction = (url: string, init: { redirect: 'manual'; signal: AbortSignal }) => Promise<FetchResponse>;

/** The outside world of the CLI. */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readStdin: () => Promise<Uint8Array>;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly readFile: (path: string) => Uint8Array;
  /** Writes a file; with `exclusive`, fails with code EEXIST when it exists. */
  readonly writeFile: (path: string, data: Uint8Array, exclusive: boolean) => void;
  readonly exists: (path: string) => boolean;
  /**
   * Reads a regular file of at most `maxBytes` through one file descriptor: opened without
   * following a final link and without blocking (a FIFO or a device is refused, not read), checked
   * with fstat, and read no further than `maxBytes + 1` bytes.
   */
  readonly readRegularFile: (path: string, maxBytes: number, within?: string) => { readonly bytes: Uint8Array } | { readonly problem: ReadProblem };
  readonly realpath: (path: string) => string;
  readonly fetch: FetchFunction;
}

/** The CLI of this Node.js process. */
export function nodeIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    async readStdin() {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of process.stdin) {
        const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
        total += bytes.length;
        // Data on stdin has the same limit as files (D-071).
        if (total > MAX_INPUT_BYTES) throw Object.assign(new Error('stdin is too large'), { code: 'EFBIG' });
        chunks.push(bytes);
      }
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    },
    stdoutIsTTY: process.stdout.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
    env: process.env,
    cwd: process.cwd(),
    readFile: (path) => {
      // One descriptor, a regular file, at most MAX_INPUT_BYTES: /dev/zero or a FIFO is refused (D-071).
      const read = readRegular(path, MAX_INPUT_BYTES);
      if ('bytes' in read) return read.bytes;
      throw Object.assign(new Error(read.problem), { code: read.problem === 'too-large' ? 'EFBIG' : 'ENOTREG' });
    },
    writeFile: (path, data, exclusive) => {
      if (exclusive) {
        writeFileSync(path, data, { flag: 'wx' });
        return;
      }
      // A replacement is a new file renamed over the old one, never written through a link (D-071).
      let link = false;
      try {
        link = lstatSync(path).isSymbolicLink();
      } catch {
        // Nothing there yet.
      }
      if (link) throw Object.assign(new Error('the output is a link'), { code: 'ELINK' });
      const temporary = join(dirname(path), `.${basename(path)}.docvane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.tmp`);
      writeFileSync(temporary, data, { flag: 'wx' });
      try {
        renameSync(temporary, path);
      } catch (error) {
        unlinkSync(temporary);
        throw error;
      }
    },
    exists: (path) => existsSync(path),
    readRegularFile: (path, maxBytes, within) => readRegular(path, maxBytes, within),
    realpath: (path) => realpathSync(path),
    fetch: (url, init) => (globalThis as unknown as { fetch: FetchFunction }).fetch(url, init),
  };
}

/** Why a file was not read. */
export type ReadProblem = 'not-a-file' | 'too-large' | 'outside' | 'hard-link';

/** The largest template or data file the CLI reads: the library's default maxInputBytes. */
export const MAX_INPUT_BYTES: number = 256 * 1024 * 1024;

/**
 * See CliIo.readRegularFile. With `within`, the opened file must also lie inside that real folder
 * and have one name: the path was checked before it was opened, and a folder swapped for a link
 * in between would be followed (D-071).
 */
export function readRegular(path: string, maxBytes: number, within?: string): { readonly bytes: Uint8Array } | { readonly problem: ReadProblem } {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (within !== undefined) {
      let opened: string | null = null;
      try {
        opened = realpathSync(`/proc/self/fd/${String(fd)}`);
      } catch {
        // No /proc: the check of the path before opening stands alone.
      }
      if (opened !== null && opened !== within && !opened.startsWith(within.endsWith('/') ? within : `${within}/`)) return { problem: 'outside' };
    }
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { problem: 'not-a-file' };
    if (within !== undefined && stat.nlink > 1) return { problem: 'hard-link' };
    if (stat.size > maxBytes) return { problem: 'too-large' };
    const buffer = new Uint8Array(Math.min(stat.size, maxBytes) + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
    }
    // The file grew between fstat and the read.
    if (length > maxBytes) return { problem: 'too-large' };
    return { bytes: buffer.subarray(0, length) };
  } finally {
    closeSync(fd);
  }
}
