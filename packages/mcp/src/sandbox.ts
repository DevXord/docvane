// The directories the MCP tools may use (D-055, D-061). Every path a client gives is resolved
// against the first root when it is relative; as text it must lie inside a root before the file
// system is asked anything, and its real path (links resolved) must lie inside the real path of a
// root. Files are read through one descriptor: opened without following a final link and without
// blocking, checked to be a regular file with one link (a hardlink can point out of a root), and
// read no further than the limit. Writing needs --allow-write and writes only inside a root: a
// new file is created exclusively; a replaced file is written to a new temporary file that is then
// renamed over it, so the old file, and any other name it has, is never changed in place.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
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
  /** The roots as given, resolved but with links kept, for the check of paths as text. */
  private readonly given: readonly string[];
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
    this.given = options.roots.map((r) => resolve(r));
    this.allowWrite = options.allowWrite === true;
    this.maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
  }

  private refuse(path: string): DvError {
    return new DvError('DV_E_FILE_READ', `The path "${path}" is outside the directories this server may use, or does not exist.`, {
      hint: `Use a path of an existing file inside the root directories of the server: ${this.roots.join(', ')}. Relative paths start at the first one.`,
      details: { path, reason: 'outside-roots' },
    });
  }

  /** The path as text, resolved against the first root, if it is inside a root as text; otherwise null. */
  private textual(path: string): string | null {
    if (path.includes('\0') || /^\\\\|^\/\//.test(path)) return null;
    const full = resolve(this.roots[0] as string, path);
    return this.roots.some((root) => inside(full, root)) || this.given.some((root) => inside(full, root)) ? full : null;
  }

  /** The real path of an existing file inside the roots. */
  file(path: string): string {
    const full = this.textual(path);
    if (full === null) throw this.refuse(path);
    let real: string;
    try {
      real = realpathSync(full);
    } catch {
      throw this.refuse(path);
    }
    if (!this.roots.some((root) => inside(real, root))) throw this.refuse(path);
    return real;
  }

  /** Reads a regular file inside the roots, through one descriptor and at most `maxFileBytes`. */
  read(path: string): Uint8Array {
    const real = this.file(path);
    let fd: number;
    try {
      fd = openSync(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (cause) {
      throw new DvError('DV_E_FILE_READ', `The file "${path}" cannot be read.`, { hint: 'Check that it is a file the server may read.', details: { path, reason: 'open' }, cause });
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new DvError('DV_E_FILE_READ', `"${path}" is not a regular file.`, { hint: 'Give the path of a file, not of a folder, a device or a pipe.', details: { path, reason: 'not-a-file' } });
      if (stat.nlink > 1) throw new DvError('DV_E_FILE_READ', `"${path}" has more than one name (a hard link); the server reads only files with one name.`, { hint: 'Copy the file instead of linking it.', details: { path, reason: 'hard-link' } });
      if (stat.size > this.maxFileBytes) throw this.tooLarge(path, stat.size);
      const buffer = new Uint8Array(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const n = readSync(fd, buffer, length, buffer.length - length, null);
        if (n === 0) break;
        length += n;
      }
      if (length > stat.size) throw this.tooLarge(path, length);
      return buffer.subarray(0, length);
    } finally {
      closeSync(fd);
    }
  }

  private tooLarge(path: string, size: number): DvError {
    return new DvError('DV_E_LIMIT_EXCEEDED', `The file "${path}" has ${String(size)} bytes or more, more than the server reads (${String(this.maxFileBytes)}).`, {
      hint: 'Start the server with a larger --max-file-size if you trust the file.',
      details: { limit: 'maxFileBytes', value: this.maxFileBytes },
    });
  }

  /** Writes a file inside the roots; refuses links and, without `overwrite`, existing files. */
  write(path: string, data: Uint8Array, overwrite: boolean): string {
    if (!this.allowWrite) {
      throw new DvError('DV_E_FILE_WRITE', 'This server is read-only.', { hint: 'Start the server with --allow-write to let the render tool write files.', details: { path, reason: 'read-only' } });
    }
    const outside = (): DvError => new DvError('DV_E_FILE_WRITE', `The path "${path}" is outside the directories this server may use.`, { hint: `Write inside the root directories: ${this.roots.join(', ')}.`, details: { path, reason: 'outside-roots' } });
    const full = this.textual(path);
    if (full === null) throw outside();
    let parent: string;
    try {
      parent = realpathSync(dirname(full));
    } catch (cause) {
      throw new DvError('DV_E_FILE_WRITE', `The folder of "${path}" does not exist.`, { hint: 'Write into an existing folder inside the root directories.', details: { path, reason: 'ENOENT' }, cause });
    }
    const target = resolve(parent, full.slice(dirname(full).length + 1));
    if (!this.roots.some((root) => inside(target, root))) throw outside();
    const existing = statOf(target);
    if (existing !== null) {
      if (existing.link) throw new DvError('DV_E_FILE_WRITE', `"${path}" is a link; the server does not write through links.`, { hint: 'Write to a regular file name.', details: { path, reason: 'link' } });
      if (!existing.file) throw new DvError('DV_E_FILE_WRITE', `"${path}" is not a regular file.`, { hint: 'Write to a regular file name.', details: { path, reason: 'not-a-file' } });
      if (!overwrite) throw new DvError('DV_E_FILE_EXISTS', `The file "${path}" already exists.`, { hint: 'Pass overwrite: true to replace it, or choose another output name.', details: { path } });
    }
    // A new name, created exclusively; for a replacement, renamed over the old file afterwards.
    const temporary = existing === null ? target : `${target}.docvane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.tmp`;
    let fd: number;
    try {
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0));
    } catch (cause) {
      const code = (cause as { code?: unknown }).code;
      if (code === 'EEXIST') throw new DvError('DV_E_FILE_EXISTS', `The file "${path}" already exists.`, { hint: 'Pass overwrite: true to replace it, or choose another output name.', details: { path } });
      throw new DvError('DV_E_FILE_WRITE', `The file "${path}" cannot be written.`, { hint: 'Check that the server may write in that folder.', details: { path, reason: typeof code === 'string' ? code : 'open' }, cause });
    }
    try {
      let written = 0;
      while (written < data.length) written += writeSync(fd, data.subarray(written));
    } finally {
      closeSync(fd);
    }
    if (temporary !== target) {
      try {
        renameSync(temporary, target);
      } catch (cause) {
        unlinkSync(temporary);
        throw new DvError('DV_E_FILE_WRITE', `The file "${path}" cannot be replaced.`, { hint: 'Check that the server may write in that folder.', details: { path, reason: 'rename' }, cause });
      }
    }
    return target;
  }
}

/** Whether a path is a link or a regular file, without following a link; null when nothing is there. */
function statOf(path: string): { link: boolean; file: boolean } | null {
  try {
    const stat = lstatSync(path);
    return { link: stat.isSymbolicLink(), file: stat.isFile() };
  } catch {
    return null;
  }
}
