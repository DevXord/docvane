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
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
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
}
