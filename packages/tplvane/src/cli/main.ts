// The command line of tplvane: inspect, render, validate, preview and make-template (D-051, D-079). It follows the CLI of
// xlvane: commands named by verbs, a welcome screen with examples, help with ready commands,
// errors in three parts with a command to try, --json with one documented document, exit codes
// 0 success, 1 a check found problems, 2 usage error, 3 input or file error.
import { basename, dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TvError, isTvError } from '../errors';
import { delimiterProblem } from '../template/lexer';
import { inspect } from '../inspect';
import { makeTemplate, type TemplateReplacement } from '../make-template';
import { DEFAULT_LIMITS } from '../limits';
import type { InspectResult, JsonSchema, SectionNode } from '../model';
import { preview } from '../preview';
import { render, renderAsync, type RenderOptions } from '../render';
import { clip } from '../util/clip';
import { suggest } from '../util/suggest';
import { validate } from '../validate';
import { VERSION } from '../version';
import { imageFetcher, resolveImageFiles } from './images';
import { MAX_INPUT_BYTES, type CliIo } from './io';
import { errorEnvelope, errorText, okEnvelope, printJson, shellQuote, styleFor, visible, warningsText } from './output';
import { COMMANDS, GLOBAL_OPTIONS, helpScreen, welcomeScreen, type CommandSpec, type OptionSpec } from './spec';

type Values = Readonly<Record<string, string | boolean | undefined>>;

interface Run {
  readonly io: CliIo;
  readonly spec: CommandSpec;
  readonly argv: readonly string[];
  readonly values: Values;
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly quiet: boolean;
}

/** A usage error, with a command to try when there is an obvious one. */
class UsageError extends TvError {
  constructor(
    message: string,
    hint: string,
    readonly tryCommand: string | null = null,
    details: Record<string, string> = {},
  ) {
    super('TV_E_USAGE', message, { hint, details });
  }
}

/** An error with a command that fixes it. */
class WithTry extends Error {
  constructor(
    readonly error: TvError,
    readonly tryCommand: string,
  ) {
    super(error.message);
  }
}

const command = (argv: readonly string[]): string => ['tplvane', ...argv].map(shellQuote).join(' ');

function fileError(error: unknown, path: string, what: 'read' | 'write'): TvError {
  const code = (error as { code?: unknown }).code;
  const reason = typeof code === 'string' ? code : 'unknown';
  if (what === 'read') {
    const message =
      reason === 'ENOENT'
        ? `File not found: "${clip(path)}".`
        : reason === 'EISDIR' || reason === 'ENOTREG'
          ? `"${clip(path)}" is not a regular file (a folder, a device or a pipe).`
          : reason === 'EFBIG'
            ? `"${clip(path)}" has more than ${String(MAX_INPUT_BYTES)} bytes, more than tplvane reads.`
            : `The file "${clip(path)}" cannot be read (${reason}).`;
    return new TvError('TV_E_FILE_READ', message, { hint: 'Check the name and the folder; paths are relative to the current directory.', details: { path: clip(path), reason }, cause: error });
  }
  if (reason === 'ELINK') return new TvError('TV_E_FILE_WRITE', `"${clip(path)}" is a link; tplvane does not write through links.`, { hint: 'Name a regular file with --output.', details: { path: clip(path), reason }, cause: error });
  return new TvError('TV_E_FILE_WRITE', `The file "${clip(path)}" cannot be written (${reason}).`, { hint: 'Check that the folder exists and that you may write there.', details: { path: clip(path), reason }, cause: error });
}

function readInput(io: CliIo, path: string): Uint8Array {
  try {
    return io.readFile(resolve(io.cwd, path));
  } catch (error) {
    throw fileError(error, path, 'read');
  }
}

async function readData(io: CliIo, path: string): Promise<{ data: unknown; dir: string; name: string }> {
  let bytes: Uint8Array;
  try {
    bytes = path === '-' ? await io.readStdin() : readInput(io, path);
  } catch (error) {
    if (isTvError(error)) throw error;
    throw fileError(error, 'stdin', 'read');
  }
  const name = path === '-' ? 'stdin' : path;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch (cause) {
    throw new TvError('TV_E_INVALID_INPUT', `The data in ${clip(name)} is not UTF-8 text.`, { hint: 'Save the data as a JSON file in UTF-8.', details: { path: clip(name) }, cause });
  }
  try {
    return { data: JSON.parse(text) as unknown, dir: path === '-' ? io.cwd : dirname(resolve(io.cwd, path)), name };
  } catch (cause) {
    throw new TvError('TV_E_INVALID_INPUT', `The data in ${clip(name)} is not valid JSON: ${clip(cause instanceof Error ? cause.message : String(cause))}`, {
      hint: 'Fix the JSON at the place the message names; a common cause is a comma after the last item, or single quotes instead of double quotes.',
      details: { path: clip(name) },
      cause,
    });
  }
}

/** The --delimiters option: two strings separated by spaces. */
function delimitersOf(values: Values): { delimiters?: { start: string; end: string } } {
  const value = values['delimiters'];
  if (typeof value !== 'string') return {};
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2) throw new UsageError(`"${visible(clip(value))}" is not a value of --delimiters.`, 'Give the start and the end delimiter separated by a space, in quotes: --delimiters "{{ }}".', null, { option: 'delimiters' });
  const delimiters = { start: parts[0] as string, end: parts[1] as string };
  const problem = delimiterProblem(delimiters);
  if (problem !== null) throw new UsageError(`"${visible(clip(value))}" is not a value of --delimiters: ${problem}.`, 'Give two different delimiters without spaces, in quotes: --delimiters "[[ ]]".', null, { option: 'delimiters' });
  return { delimiters };
}

/** Checks --locale and --time-zone before any file is read, as errors of usage. */
function checkIntl(values: Values): void {
  const locale = values['locale'];
  const zone = values['time-zone'];
  try {
    if (typeof locale === 'string') Intl.getCanonicalLocales(locale);
  } catch {
    throw new UsageError(`"${visible(clip(String(locale)))}" is not a value of --locale.`, 'Give a locale such as pl-PL or en-US.', null, { option: 'locale' });
  }
  try {
    if (typeof zone === 'string') new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new UsageError(`"${visible(clip(String(zone)))}" is not a value of --time-zone.`, 'Give an IANA time zone such as Europe/Warsaw or UTC.', null, { option: 'time-zone' });
  }
}

function renderOptions(values: Values): RenderOptions {
  checkIntl(values);
  const out: { locale?: string; timeZone?: string; missing?: 'error' | 'empty'; delimiters?: { start: string; end: string } } = { ...delimitersOf(values) };
  if (typeof values['locale'] === 'string') out.locale = values['locale'];
  if (typeof values['time-zone'] === 'string') out.timeZone = values['time-zone'];
  if (values['missing'] === 'empty' || values['missing'] === 'error') out.missing = values['missing'];
  return out;
}

function formatBytes(n: number): string {
  return n < 1024 ? `${String(n)} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const FORMAT_NAMES = { docx: 'Word document', pptx: 'PowerPoint presentation', xlsx: 'Excel workbook' } as const;

/** The data fields of a schema, one line each, indented by depth. */
function schemaLines(schema: JsonSchema, depth: number, out: string[]): void {
  const required = new Set(schema.required ?? []);
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const kind = kindOf(prop);
    out.push(`${'  '.repeat(depth + 1)}${visible(name).padEnd(Math.max(1, 24 - depth * 2))} ${kind}${required.has(name) ? ', required' : ''}`);
    const inner = prop.type === 'array' ? prop.items : prop;
    if (inner !== undefined && inner.properties !== undefined) schemaLines(inner, depth + 1, out);
  }
}

function kindOf(s: JsonSchema): string {
  if (s.anyOf !== undefined) return s.anyOf.some((o) => o.properties?.['data'] !== undefined) ? 'image' : s.anyOf.map(kindOf).join(' or ');
  const type = s.type;
  if (Array.isArray(type)) return 'value';
  switch (type) {
    case 'array':
      return s.items?.properties !== undefined ? 'list of objects' : 'list of values';
    case 'object':
      return 'object';
    case 'boolean':
      return 'condition';
    case 'string':
      return 'text';
    default:
      return 'value';
  }
}

function sectionLines(sections: readonly SectionNode[], depth: number, out: string[]): void {
  for (const s of sections) {
    out.push(`${'  '.repeat(depth + 1)}${s.kind.padEnd(10)} ${visible(clip(s.path)).padEnd(20)} ${visible(s.open.location.description ?? '')}`);
    sectionLines(s.sections, depth + 1, out);
  }
}

function inspectText(file: string, result: InspectResult): string {
  const lines = [`${visible(file)}: ${FORMAT_NAMES[result.format]}, ${String(result.tags.length)} ${result.tags.length === 1 ? 'tag' : 'tags'}`, ''];
  lines.push('Data:');
  const before = lines.length;
  schemaLines(result.schema, 0, lines);
  if (lines.length === before) lines.push('  (none: the template has no tags)');
  if (result.sections.length > 0) {
    lines.push('', 'Sections:');
    sectionLines(result.sections, 0, lines);
  }
  if (result.tags.length > 0) {
    lines.push('', 'Tags:');
    for (const t of result.tags) lines.push(`  ${visible(clip(t.raw)).padEnd(32)} ${visible(t.location.description ?? '')}`);
  }
  return `${lines.join('\n')}\n`;
}

async function runInspect(r: Run): Promise<number> {
  const file = r.positionals[0] as string;
  const result = inspect(readInput(r.io, file), delimitersOf(r.values));
  if (r.json) printJson(r.io, okEnvelope('inspect', { file, ...result }));
  else if (r.values['schema'] === true) r.io.stdout(`${JSON.stringify(result.schema, null, 2)}\n`);
  else {
    r.io.stdout(inspectText(file, result));
    if (!r.quiet && result.warnings.length > 0) r.io.stderr(warningsText(result.warnings, styleFor(r.io.stderrIsTTY, r.io.env)));
  }
  return 0;
}

async function runRender(r: Run): Promise<number> {
  const [templatePath, dataPath] = r.positionals as [string, string];
  const options = renderOptions(r.values);
  const output = typeof r.values['output'] === 'string' ? r.values['output'] : `${basename(templatePath, extname(templatePath))}-filled${extname(templatePath)}`;
  if (output === '-') throw new UsageError('--output - would write a file named "-"; tplvane does not write the result to stdout.', 'Name the output file, for example --output result.docx.', null, { option: 'output' });
  const target = resolve(r.io.cwd, output);
  const dryRun = r.values['dry-run'] === true;
  const force = r.values['force'] === true;
  const replaced = r.io.exists(target);
  if (replaced && !force && !dryRun) {
    throw new WithTry(new TvError('TV_E_FILE_EXISTS', `The file "${clip(output)}" already exists.`, { hint: 'Add --force to replace it, or name another file with --output.', details: { path: clip(output) } }), command([...r.argv, '--force']));
  }
  const template = readInput(r.io, templatePath);
  const { data, dir, name } = await readData(r.io, dataPath);
  const inspected = inspect(template, delimitersOf(r.values));
  const fetchImages = r.values['fetch-images'] === true;
  try {
    resolveImageFiles(r.io, data, inspected, dir, DEFAULT_LIMITS, fetchImages);
  } catch (error) {
    if (isTvError(error) && error.details['address'] === true) throw new WithTry(error, command([...r.argv, '--fetch-images']));
    throw error;
  }
  const warnings: { code: string; message: string }[] = [];
  const all: RenderOptions = { ...options, onWarning: (w) => warnings.push(w) };
  const bytes = fetchImages ? await renderAsync(template, data, { ...all, fetchImage: imageFetcher(r.io.fetch, DEFAULT_LIMITS.maxImageBytes) }) : render(template, data, all);
  if (!dryRun) {
    try {
      r.io.writeFile(target, bytes, !force);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EEXIST') throw new WithTry(new TvError('TV_E_FILE_EXISTS', `The file "${clip(output)}" already exists.`, { hint: 'Add --force to replace it, or name another file with --output.', details: { path: clip(output) } }), command([...r.argv, '--force']));
      throw fileError(error, output, 'write');
    }
  }
  if (r.json) {
    printJson(r.io, okEnvelope('render', { template: templatePath, data: name, output, format: inspected.format, bytes: bytes.length, written: !dryRun, replaced: !dryRun && replaced, warnings }));
  } else if (!r.quiet) {
    const style = styleFor(r.io.stderrIsTTY, r.io.env);
    if (warnings.length > 0) r.io.stderr(warningsText(warnings as never, style));
    r.io.stdout(
      dryRun
        ? `Checked: ${visible(templatePath)} with ${visible(name)} renders without problems (${formatBytes(bytes.length)}). Nothing was written (--dry-run).\n`
        : `Wrote ${visible(output)} (${formatBytes(bytes.length)}) from ${visible(templatePath)} and ${visible(name)}.${replaced ? ' The file was replaced.' : ''}\n`,
    );
  }
  return 0;
}

async function runValidate(r: Run): Promise<number> {
  const [templatePath, dataPath] = r.positionals as [string, string];
  const options = renderOptions(r.values);
  const template = readInput(r.io, templatePath);
  const { data, dir, name } = await readData(r.io, dataPath);
  resolveImageFiles(r.io, data, inspect(template, delimitersOf(r.values)), dir, DEFAULT_LIMITS, true);
  const result = validate(template, data, options);
  if (r.json) {
    printJson(r.io, okEnvelope('validate', { template: templatePath, data: name, valid: result.valid, errors: result.errors.map((e) => e.toJSON()), warnings: result.warnings }));
    return result.valid ? 0 : 1;
  }
  const style = styleFor(r.io.stdoutIsTTY, r.io.env);
  if (result.valid) {
    if (!r.quiet) r.io.stdout(`Valid: ${visible(name)} has everything ${visible(templatePath)} needs.\n`);
  } else {
    const aggregate = new TvError('TV_E_DATA_INVALID', 'The data has problems.', { location: result.errors[0]?.location ?? {}, hint: 'Fix the problems listed.', errors: result.errors });
    r.io.stdout(errorText(aggregate, style, name, null).replace(/^.*?Error:\S*\s/, ''));
  }
  if (!r.quiet && result.warnings.length > 0) r.io.stderr(warningsText(result.warnings, styleFor(r.io.stderrIsTTY, r.io.env)));
  return result.valid ? 0 : 1;
}

async function runPreview(r: Run): Promise<number> {
  const file = r.positionals[0] as string;
  const result = preview(readInput(r.io, file));
  if (r.json) printJson(r.io, okEnvelope('preview', { file, ...result }));
  else r.io.stdout(visible(result.text).replace(/\\x0a/g, '\n'));
  return 0;
}

/** What an entry of the map writes, for the screen. */
function replacementText(entry: unknown, delimiters: { start: string; end: string } | undefined): string {
  const e = entry as { tag?: unknown; with?: unknown };
  return typeof e.tag === 'string' ? `${delimiters?.start ?? '{'}${e.tag}${delimiters?.end ?? '}'}` : typeof e.with === 'string' ? e.with : '';
}

async function runMakeTemplate(r: Run): Promise<number> {
  const [documentPath, mapPath] = r.positionals as [string, string];
  const options = delimitersOf(r.values);
  const output = typeof r.values['output'] === 'string' ? r.values['output'] : `${basename(documentPath, extname(documentPath))}-template${extname(documentPath)}`;
  if (output === '-') throw new UsageError('--output - would write a file named "-"; tplvane does not write the result to stdout.', 'Name the output file, for example --output template.docx.', null, { option: 'output' });
  const target = resolve(r.io.cwd, output);
  const dryRun = r.values['dry-run'] === true;
  const force = r.values['force'] === true;
  const replaced = r.io.exists(target);
  if (replaced && !force && !dryRun) {
    throw new WithTry(new TvError('TV_E_FILE_EXISTS', `The file "${clip(output)}" already exists.`, { hint: 'Add --force to replace it, or name another file with --output.', details: { path: clip(output) } }), command([...r.argv, '--force']));
  }
  const document = readInput(r.io, documentPath);
  const { data: map, name } = await readData(r.io, mapPath);
  if (!Array.isArray(map)) {
    throw new TvError('TV_E_INVALID_INPUT', `The map in ${clip(name)} must be a JSON list of entries.`, { hint: 'Write it as [{"find": "Anna Nowak", "tag": "customer.name"}, {"find": "Laptop", "with": "{#items}{name}"}].', details: { path: clip(name) } });
  }
  const result = makeTemplate(document, map as TemplateReplacement[], options);
  if (!dryRun) {
    try {
      r.io.writeFile(target, result.document, !force);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EEXIST') throw new WithTry(new TvError('TV_E_FILE_EXISTS', `The file "${clip(output)}" already exists.`, { hint: 'Add --force to replace it, or name another file with --output.', details: { path: clip(output) } }), command([...r.argv, '--force']));
      throw fileError(error, output, 'write');
    }
  }
  if (r.json) {
    printJson(r.io, okEnvelope('make-template', { document: documentPath, map: name, output, bytes: result.document.length, written: !dryRun, replaced: !dryRun && replaced, replacements: result.replacements, schema: result.schema, warnings: result.warnings }));
    return 0;
  }
  if (r.quiet) return 0;
  const lines = [
    dryRun
      ? `Checked: ${visible(documentPath)} with ${visible(name)} makes a valid template (${formatBytes(result.document.length)}). Nothing was written (--dry-run).`
      : `Wrote ${visible(output)} (${formatBytes(result.document.length)}) from ${visible(documentPath)} and ${visible(name)}.${replaced ? ' The file was replaced.' : ''}`,
    '',
    'Replaced:',
  ];
  result.replacements.forEach((report, i) => {
    const first = report.locations[0]?.description ?? '';
    const more = report.count > 1 ? ` (and ${String(report.count - 1)} more)` : '';
    lines.push(`  ${visible(clip(`"${report.find}"`)).padEnd(24)} -> ${visible(clip(replacementText(map[i], options.delimiters))).padEnd(28)} ${String(report.count).padStart(3)}x  ${visible(first)}${more}`);
  });
  lines.push('', 'Data:');
  const before = lines.length;
  schemaLines(result.schema, 0, lines);
  if (lines.length === before) lines.push('  (none)');
  r.io.stdout(`${lines.join('\n')}\n`);
  if (result.warnings.length > 0) r.io.stderr(warningsText(result.warnings, styleFor(r.io.stderrIsTTY, r.io.env)));
  return 0;
}

const RUNNERS: Readonly<Record<string, (r: Run) => Promise<number>>> = { inspect: runInspect, render: runRender, validate: runValidate, preview: runPreview, 'make-template': runMakeTemplate };

/** Checks the options of `argv` before parseArgs, to name unknown ones with a suggestion. */
function checkOptions(argv: readonly string[], options: readonly OptionSpec[], name: string): void {
  const long = options.map((o) => o.name);
  const short = new Map(options.filter((o) => o.short !== undefined).map((o) => [o.short as string, o.name]));
  for (const arg of argv) {
    if (arg === '--') break;
    if (arg.startsWith('--')) {
      const option = arg.slice(2).split('=')[0] as string;
      if (long.includes(option)) continue;
      const close = suggest(option, long);
      const fixed = close[0] === undefined ? null : command([name, ...argv.map((a) => (a === arg ? `--${close[0] as string}${arg.includes('=') ? arg.slice(arg.indexOf('=')) : ''}` : a))]);
      throw new UsageError(
        `Unknown option "--${visible(clip(option))}" for "tplvane ${name}".`,
        `${close.length > 0 ? `Did you mean "--${close[0] as string}"? ` : ''}Options: ${long.map((o) => `--${o}`).join(', ')}. Run "tplvane help ${name}" for examples.`,
        fixed,
        { option: clip(option) },
      );
    } else if (arg.startsWith('-') && arg !== '-') {
      for (const letter of arg.slice(1)) {
        if (!short.has(letter)) {
          throw new UsageError(`Unknown option "-${visible(letter)}" for "tplvane ${name}".`, `Options: ${long.map((o) => `--${o}`).join(', ')}. Run "tplvane help ${name}" for examples.`, null, { option: letter });
        }
      }
    }
  }
}

function parse(spec: CommandSpec, argv: readonly string[]): { values: Values; positionals: string[] } {
  const all = [...spec.options, ...GLOBAL_OPTIONS];
  checkOptions(argv, all, spec.name);
  const config: Record<string, { type: 'string' | 'boolean'; short?: string }> = {};
  for (const o of all) config[o.name] = o.short === undefined ? { type: o.type } : { type: o.type, short: o.short };
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options: config, strict: true, allowPositionals: true }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (error) {
    // The only error left after checkOptions: a string option without its value.
    const option = all.find((o) => o.type === 'string' && argv.some((a, i) => (a === `--${o.name}` || (o.short !== undefined && a === `-${o.short}`)) && (argv[i + 1] === undefined || (argv[i + 1] as string).startsWith('-'))))?.name ?? '';
    void error;
    throw new UsageError(`The option "--${visible(clip(option))}" needs a value.`, `Write the value after the option, for example --${clip(option)} value. Run "tplvane help ${spec.name}" for examples.`, null, { option: clip(option) });
  }
  for (const o of all) {
    const v = parsed.values[o.name];
    if (o.choices !== undefined && typeof v === 'string' && !o.choices.includes(v)) {
      throw new UsageError(`"${visible(clip(v))}" is not a value of --${o.name}.`, `Use one of: ${o.choices.join(', ')}.`, null, { option: o.name });
    }
  }
  if (parsed.values['help'] !== true) {
    const want = spec.positionals.length;
    if (parsed.positionals.length < want) {
      const missing = spec.positionals[parsed.positionals.length] as string;
      throw new UsageError(`"tplvane ${spec.name}" needs the ${missing} file.`, `Usage: ${spec.usage}. Run "tplvane help ${spec.name}" for examples.`, null, { argument: missing });
    }
    if (parsed.positionals.length > want) {
      const extra = parsed.positionals[want] as string;
      throw new UsageError(`Unexpected argument "${visible(clip(extra))}" for "tplvane ${spec.name}".`, `Usage: ${spec.usage}. Quote file names that contain spaces.`, null, { argument: clip(extra) });
    }
  }
  return { values: parsed.values, positionals: parsed.positionals };
}

/** Prints an error, in JSON or for people, and returns the exit code. */
function fail(io: CliIo, name: string | null, error: unknown, json: boolean, verbose: boolean, file: string | undefined): number {
  const tryCommand = error instanceof WithTry ? error.tryCommand : error instanceof UsageError ? error.tryCommand : null;
  const dv: TvError = error instanceof WithTry ? error.error : isTvError(error) ? error : new TvError('TV_E_INTERNAL', `Internal error: ${clip(error instanceof Error ? error.message : String(error))}`, { hint: 'This is a bug in tplvane. Please report it with the command and, if you can, the files. Run with --verbose for the stack trace.', cause: error });
  if (json) printJson(io, errorEnvelope(name, dv, tryCommand));
  else {
    io.stderr(errorText(dv, styleFor(io.stderrIsTTY, io.env), file, tryCommand));
    if (verbose && dv.code === 'TV_E_INTERNAL' && error instanceof Error && error.stack !== undefined) io.stderr(`${error.stack}\n`);
  }
  return dv.code === 'TV_E_USAGE' ? 2 : 3;
}

/**
 * Runs the command line with `argv` (the arguments after the program name) and returns the exit
 * code: 0 success, 1 a check found problems, 2 usage error, 3 input or file error.
 */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  // --json counts only before "--", after which every argument is a file name.
  const end = argv.indexOf('--');
  const json = (end === -1 ? argv : argv.slice(0, end)).includes('--json');
  const first = argv[0];
  // Help is text for people, also with --json (docs/cli-json.md).
  const bare = argv.filter((a) => a !== '--json');
  if (first === undefined || ((bare[0] === '--help' || bare[0] === '-h' || bare[0] === 'help') && bare.length === 1)) {
    io.stdout(welcomeScreen());
    return 0;
  }
  if (first === '--version' || first === '-v') {
    io.stdout(`tplvane ${VERSION}\n`);
    return 0;
  }
  if (first === 'help') {
    const name = argv[1] as string;
    const spec = COMMANDS.find((c) => c.name === name);
    if (spec !== undefined) {
      io.stdout(helpScreen(spec));
      return 0;
    }
    const close = suggest(name, COMMANDS.map((c) => c.name));
    return fail(io, null, new UsageError(`There is no command "${visible(clip(name))}".`, `${close.length > 0 ? `Did you mean "tplvane help ${close[0] as string}"? ` : ''}Commands: ${COMMANDS.map((c) => c.name).join(', ')}.`, close[0] === undefined ? null : command(['help', close[0]])), json, false, undefined);
  }
  const spec = COMMANDS.find((c) => c.name === first);
  if (spec === undefined) {
    const close = suggest(first, COMMANDS.map((c) => c.name));
    const hint = `${close.length > 0 ? `Did you mean "tplvane ${close[0] as string}"? ` : ''}Commands: ${COMMANDS.map((c) => c.name).join(', ')}. Run "tplvane" for examples.`;
    const error = first.startsWith('-') ? new UsageError(`Unknown option "${visible(clip(first))}" before a command.`, `Start with a command, for example "tplvane inspect offer.docx". ${hint}`) : new UsageError(`Unknown command "${visible(clip(first))}".`, hint, close[0] === undefined ? null : command([close[0], ...argv.slice(1)]), { command: clip(first) });
    return fail(io, null, error, json, false, undefined);
  }
  const rest = argv.slice(1);
  let parsed: { values: Values; positionals: string[] };
  try {
    parsed = parse(spec, rest);
  } catch (error) {
    return fail(io, spec.name, error, json, false, undefined);
  }
  if (parsed.values['help'] === true) {
    io.stdout(helpScreen(spec));
    return 0;
  }
  const run: Run = { io, spec, argv, values: parsed.values, positionals: parsed.positionals, json, quiet: parsed.values['quiet'] === true };
  try {
    return await (RUNNERS[spec.name] as (r: Run) => Promise<number>)(run);
  } catch (error) {
    const dv = error instanceof WithTry ? error.error : error;
    const file = isTvError(dv) && dv.code !== 'TV_E_FILE_READ' && dv.code !== 'TV_E_FILE_EXISTS' && dv.code !== 'TV_E_FILE_WRITE' && dv.code !== 'TV_E_INVALID_INPUT' ? parsed.positionals[0] : undefined;
    return fail(io, spec.name, error, json, parsed.values['verbose'] === true, file);
  }
}


