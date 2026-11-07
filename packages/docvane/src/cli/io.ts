// What the command line reaches outside itself: output, input, the environment, files and the
// network. `main` takes it as a parameter, so that tests run the CLI in memory; `nodeIo` gives
// the real process. Only the CLI (this folder) uses Node.js modules; the library does not.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
    realpath: (path) => realpathSync(path),
    fetch: (url, init) => (globalThis as unknown as { fetch: FetchFunction }).fetch(url, init),
  };
}
