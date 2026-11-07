// What the command line reaches outside itself: output, input, the environment, files and the
// network. `main` takes it as a parameter, so that tests run the CLI in memory; `nodeIo` gives
// the real process. Only the CLI (this folder) uses Node.js modules; the library does not.
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
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
  readonly readRegularFile: (path: string, maxBytes: number) => { readonly bytes: Uint8Array } | { readonly problem: 'not-a-file' | 'too-large' };
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
      for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
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
    readFile: (path) => readFileSync(path),
    writeFile: (path, data, exclusive) => writeFileSync(path, data, { flag: exclusive ? 'wx' : 'w' }),
    exists: (path) => existsSync(path),
    readRegularFile: (path, maxBytes) => readRegular(path, maxBytes),
    realpath: (path) => realpathSync(path),
    fetch: (url, init) => (globalThis as unknown as { fetch: FetchFunction }).fetch(url, init),
  };
}

/** See CliIo.readRegularFile. */
export function readRegular(path: string, maxBytes: number): { readonly bytes: Uint8Array } | { readonly problem: 'not-a-file' | 'too-large' } {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { problem: 'not-a-file' };
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
