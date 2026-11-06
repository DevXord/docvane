// The directories the MCP tools may use (D-055). Every path a client gives is resolved against the
// first root when it is relative, and its real path (links resolved) must lie inside the real path
// of one of the roots. Writing needs --allow-write, writes only inside a root, never through a link,
// and replaces a file only when the client asks for it.
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { DvError } from 'docvane';

/**
 * Options of the server's file access: the root directories, and whether writing is allowed.
 *
 * @example
 * ```ts
 * import { Sandbox, type SandboxOptions } from '@docvane/mcp';
 *
 * const options: SandboxOptions = { roots: ['./templates'], allowWrite: false };
 * console.log(new Sandbox(options).roots);
 * ```
 */
export interface SandboxOptions {
  /** The directories the tools may read (and, with `allowWrite`, write). At least one. */
  readonly roots: readonly string[];
  /** Whether the `render` tool may write files. Default false. */
  readonly allowWrite?: boolean;
  /** The largest file the tools read, in bytes. Default 50 MiB. */
  readonly maxFileBytes?: number;
}

const inside = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * The files the tools may use: only inside the root directories (links resolved), read-only unless
 * `allowWrite`, and no file replaced unless the call asks for it.
 *
 * @example
 * ```ts
 * import { Sandbox } from '@docvane/mcp';
 *
 * const sandbox = new Sandbox({ roots: ['./templates'] });
 * const bytes = sandbox.read('offer.docx'); // relative to the first root
 * console.log(bytes.length);
 * ```
 */
export class Sandbox {
  readonly roots: readonly string[];
  readonly allowWrite: boolean;
  readonly maxFileBytes: number;

  constructor(options: SandboxOptions) {
    if (options.roots.length === 0) {
      throw new DvError('DV_E_INVALID_OPTION', 'The MCP server needs at least one root directory.', { hint: 'Start it with --root <dir>, the directory whose files the tools may use.', details: { option: 'roots' } });
    }
    this.roots = options.roots.map((r) => {
      try {
        return realpathSync(resolve(r));
      } catch (cause) {
        throw new DvError('DV_E_INVALID_OPTION', `The root directory "${r}" does not exist.`, { hint: 'Pass an existing directory with --root.', details: { option: 'roots', path: r }, cause });
      }
    });
    this.allowWrite = options.allowWrite === true;
    this.maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
  }

  private refuse(path: string, why: string): DvError {
    return new DvError('DV_E_FILE_READ', `The path "${path}" ${why}.`, {
      hint: `Use a path inside the root directories of the server: ${this.roots.join(', ')}. Relative paths start at the first one.`,
      details: { path, reason: 'outside-roots' },
    });
  }

  /** The real path of an existing file inside the roots. */
  file(path: string): string {
    if (path.includes('\0')) throw this.refuse(path, 'is not a valid path');
    const full = isAbsolute(path) ? path : resolve(this.roots[0] as string, path);
    let real: string;
    try {
      real = realpathSync(full);
    } catch (cause) {
      throw new DvError('DV_E_FILE_READ', `File not found: "${path}".`, { hint: 'Check the name; relative paths start at the first root directory of the server.', details: { path, reason: 'ENOENT' }, cause });
    }
    if (!this.roots.some((root) => inside(real, root))) throw this.refuse(path, 'is outside the directories this server may use');
    if (!statSync(real).isFile()) throw new DvError('DV_E_FILE_READ', `"${path}" is not a file.`, { hint: 'Give the path of a file.', details: { path, reason: 'EISDIR' } });
    return real;
  }

  /** Reads a file inside the roots. */
  read(path: string): Uint8Array {
    const real = this.file(path);
    const size = statSync(real).size;
    if (size > this.maxFileBytes) {
      throw new DvError('DV_E_LIMIT_EXCEEDED', `The file "${path}" has ${String(size)} bytes, more than the server reads (${String(this.maxFileBytes)}).`, { hint: 'Start the server with a larger --max-file-size if you trust the file.', details: { limit: 'maxFileBytes', value: this.maxFileBytes } });
    }
    return readFileSync(real);
  }

  /** Writes a file inside the roots; refuses links and, without `overwrite`, existing files. */
  write(path: string, data: Uint8Array, overwrite: boolean): string {
    if (!this.allowWrite) {
      throw new DvError('DV_E_FILE_WRITE', 'This server is read-only.', { hint: 'Start the server with --allow-write to let the render tool write files.', details: { path, reason: 'read-only' } });
    }
    if (path.includes('\0')) throw this.refuse(path, 'is not a valid path');
    const full = isAbsolute(path) ? path : resolve(this.roots[0] as string, path);
    let parent: string;
    try {
      parent = realpathSync(dirname(full));
    } catch (cause) {
      throw new DvError('DV_E_FILE_WRITE', `The folder of "${path}" does not exist.`, { hint: 'Write into an existing folder inside the root directories.', details: { path, reason: 'ENOENT' }, cause });
    }
    const target = resolve(parent, full.slice(dirname(full).length + 1));
    if (!this.roots.some((root) => inside(target, root))) throw new DvError('DV_E_FILE_WRITE', `The path "${path}" is outside the directories this server may use.`, { hint: `Write inside the root directories: ${this.roots.join(', ')}.`, details: { path, reason: 'outside-roots' } });
    if (existsSync(target) || isLink(target)) {
      if (isLink(target)) throw new DvError('DV_E_FILE_WRITE', `"${path}" is a link; the server does not write through links.`, { hint: 'Write to a regular file name.', details: { path, reason: 'link' } });
      if (!overwrite) throw new DvError('DV_E_FILE_EXISTS', `The file "${path}" already exists.`, { hint: 'Pass overwrite: true to replace it, or choose another output name.', details: { path } });
    }
    writeFileSync(target, data, { flag: overwrite ? 'w' : 'wx' });
    return target;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
