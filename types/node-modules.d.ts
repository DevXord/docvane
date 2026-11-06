// Minimal declarations for the few Node.js built-in modules used by the tests. The project does
// not depend on @types/node. Signatures follow https://nodejs.org/api/ and are intentionally
// narrower than the real APIs: add a member here only when code needs it.

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function readFileSync(path: string | URL): Uint8Array;
  export function readdirSync(path: string | URL): string[];
  export function statSync(path: string | URL): { isDirectory(): boolean };
  export function existsSync(path: string | URL): boolean;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string | URL, data: Uint8Array | string): void;
  export function rmSync(path: string | URL, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: Uint8Array | string, options: { flag?: 'w' | 'wx' }): void;
  export function realpathSync(path: string): string;
  export function symlinkSync(target: string, path: string): void;
}

declare module 'node:util' {
  export interface ParseArgsOptionConfig {
    type: 'string' | 'boolean';
    short?: string;
    multiple?: boolean;
  }
  export function parseArgs(config: { args: readonly string[]; options: Record<string, ParseArgsOptionConfig>; strict: true; allowPositionals: true }): {
    values: Record<string, string | boolean | undefined>;
    positionals: string[];
  };
}

declare module 'node:process' {
  interface WriteStream {
    readonly isTTY?: boolean;
    readonly columns?: number;
    write(text: string): boolean;
  }
  interface ReadStream {
    readonly isTTY?: boolean;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
  }
  const process: {
    readonly argv: readonly string[];
    readonly env: Record<string, string | undefined>;
    readonly stdout: WriteStream;
    readonly stderr: WriteStream;
    readonly stdin: ReadStream;
    exitCode: number | undefined;
    cwd(): string;
  };
  export default process;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export const sep: string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:child_process' {
  export function spawnSync(command: string, args: readonly string[], options: { cwd?: string; encoding: 'utf8'; timeout?: number }): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

declare module 'node:zlib' {
  export function crc32(data: Uint8Array | string, value?: number): number;
  export function deflateRawSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
  export function deflateSync(data: Uint8Array): Uint8Array;
}
