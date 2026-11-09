// Runs the CLI in this process, in a temporary folder with the files of examples/offer (the
// template built by scripts/lib/fixtures.mjs, the data and the logo), and
// captures what it prints. fetch is a stub that records the addresses it is asked for.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../packages/tplvane/src/cli/main';
import { nodeIo, type CliIo, type FetchResponse } from '../../packages/tplvane/src/cli/io';
import { offerDocx } from '../../scripts/lib/fixtures.mjs';

export const EXAMPLE = fileURLToPath(new URL('../../examples/offer', import.meta.url));

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A new folder with offer.docx, data.json and logo.png. */
export function exampleFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tplvane-cli-'));
  writeFileSync(join(dir, 'offer.docx'), offerDocx());
  for (const name of ['data.json', 'logo.png']) writeFileSync(join(dir, name), readFileSync(join(EXAMPLE, name)));
  return dir;
}

export interface RunOptions {
  readonly stdin?: string;
  readonly tty?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly fetch?: (url: string) => FetchResponse;
  readonly fetched?: string[];
}

/** Runs `tplvane <argv>` in `dir`. */
export async function runCli(dir: string, argv: readonly string[], options: RunOptions = {}): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const real = nodeIo();
  const io: CliIo = {
    ...real,
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    readStdin: () => Promise.resolve(new TextEncoder().encode(options.stdin ?? '')),
    stdoutIsTTY: options.tty ?? false,
    stderrIsTTY: options.tty ?? false,
    env: options.env ?? {},
    cwd: dir,
    fetch: (url) => {
      options.fetched?.push(url);
      if (options.fetch === undefined) return Promise.reject(new Error('the network is not used in tests'));
      return Promise.resolve(options.fetch(url));
    },
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

/** A fetch answer with a body. */
export function response(status: number, body: Uint8Array, headers: Record<string, string> = {}): FetchResponse {
  let sent = false;
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: () => {
          if (sent) return Promise.resolve({ done: true });
          sent = true;
          return Promise.resolve({ done: false, value: body });
        },
        cancel: () => Promise.resolve(),
      }),
    },
  };
}
