// How the CLI writes: text for people (with colour only on a terminal, never with NO_COLOR), or one
// JSON document with --json (docs/cli-json.md in the package). Errors in three parts: what
// happened, where, what to do.
import { DvError, type DvWarning } from '../errors';
import type { CliIo } from './io';

/** The version of the JSON output; it changes only when a field is removed or changes meaning. */
export const JSON_VERSION = 1;

/** Control characters from files and arguments, written visibly so that a file cannot send commands to the terminal. */
export function visible(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** Quotes an argument for POSIX shells when needed. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export interface Style {
  readonly bold: (s: string) => string;
  readonly red: (s: string) => string;
  readonly yellow: (s: string) => string;
  readonly dim: (s: string) => string;
}

export function styleFor(isTTY: boolean, env: Readonly<Record<string, string | undefined>>): Style {
  const on = isTTY && env['NO_COLOR'] === undefined && env['TERM'] !== 'dumb';
  const wrap = (open: number, close: number) => (s: string): string => (on ? `\u001b[${String(open)}m${s}\u001b[${String(close)}m` : s);
  return { bold: wrap(1, 22), red: wrap(31, 39), yellow: wrap(33, 39), dim: wrap(2, 22) };
}

/** Wraps `text` at `width` columns, indenting the following lines by `indent` spaces. */
export function wrapText(text: string, width: number, indent: number): string {
  const words = text.split(/ +/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line !== '' && line.length + 1 + word.length > width - indent) {
      lines.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines.join(`\n${' '.repeat(indent)}`);
}

const WIDTH = 100;

/** Where an error is, in words: the file and the place in it. */
function placeOf(error: DvError, file: string | undefined): string | null {
  const parts: string[] = [];
  const dataPath = error.details['dataPath'];
  if (typeof dataPath === 'string' && dataPath !== '') parts.push(`${dataPath} in the data`);
  const where = error.location.description ?? error.location.part;
  if (where !== undefined) {
    const character = error.location.character === undefined ? '' : `, character ${String(error.location.character)}`;
    parts.push(`${file === undefined ? '' : `${file}, `}${where}${character}`);
  } else if (file !== undefined && typeof error.details['path'] !== 'string' && parts.length === 0) return null;
  return parts.length === 0 ? null : parts.join('; ');
}

/** An error for people, on stderr: Error, Where, Fix, Try and Code; for an aggregate, each problem. */
export function errorText(error: DvError, style: Style, file: string | undefined, tryCommand: string | null): string {
  const out: string[] = [];
  const label = (name: string): string => style.bold(`${name}:`.padEnd(7));
  if (error.errors.length > 0) {
    const what = error.code === 'DV_E_DATA_INVALID' ? 'The data has' : 'The template has';
    out.push(`${style.red(style.bold('Error:'))} ${what} ${String(error.errors.length)}${error.details['truncated'] === true ? ' or more' : ''} ${error.errors.length === 1 ? 'problem' : 'problems'}${file === undefined ? '' : ` (${visible(file)})`}:`);
    error.errors.forEach((e, i) => {
      out.push(`  ${String(i + 1)}. ${wrapText(visible(e.message), WIDTH, 5)}`);
      const where = placeOf(e, undefined);
      if (where !== null) out.push(`     Where: ${wrapText(visible(where), WIDTH, 12)}`);
      out.push(`     Fix:   ${wrapText(visible(e.hint), WIDTH, 12)}`);
      out.push(`     ${style.dim(`Code:  ${e.code}`)}`);
    });
    out.push(style.dim(`Code:  ${error.code} · docs/errors.md#${error.code.toLowerCase()}`));
    return `${out.join('\n')}\n`;
  }
  out.push(`${style.red(style.bold('Error:'))} ${wrapText(visible(error.message), WIDTH, 7)}`);
  const where = placeOf(error, file);
  if (where !== null) out.push(`${label('Where')}${wrapText(visible(where), WIDTH, 7)}`);
  // The underlying error of a fetch or of xlvane says what exactly failed.
  if (error.cause instanceof Error && error.code !== 'DV_E_INTERNAL' && error.code !== 'DV_E_FILE_READ' && error.code !== 'DV_E_FILE_WRITE' && !error.message.includes(error.cause.message.slice(0, 40))) out.push(`${label('Cause')}${wrapText(visible(error.cause.message), WIDTH, 7)}`);
  out.push(`${label('Fix')}${wrapText(visible(error.hint), WIDTH, 7)}`);
  if (tryCommand !== null) out.push(`${label('Try')}${tryCommand}`);
  out.push(style.dim(`Code:  ${error.code} · docs/errors.md#${error.code.toLowerCase()}`));
  return `${out.join('\n')}\n`;
}

/** Warnings for people, on stderr. */
export function warningsText(warnings: readonly DvWarning[], style: Style): string {
  return warnings.map((w) => `${style.yellow(style.bold('Warning:'))} ${wrapText(visible(w.message), WIDTH, 9)}${w.location.description === undefined ? '' : `\n         Where: ${visible(w.location.description)}`}\n         Fix:   ${wrapText(visible(w.hint), WIDTH, 16)}\n`).join('');
}

/** Prints one JSON document: indented on a terminal, on one line otherwise. */
export function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, io.stdoutIsTTY ? 2 : undefined)}\n`);
}

/** The JSON envelope of a success. */
export function okEnvelope(command: string, result: unknown): unknown {
  return { docvane: JSON_VERSION, command, ok: true, result };
}

/** The JSON envelope of a failure. */
export function errorEnvelope(command: string | null, error: DvError, tryCommand: string | null): unknown {
  return { docvane: JSON_VERSION, command, ok: false, error: error.toJSON(), try: tryCommand };
}
