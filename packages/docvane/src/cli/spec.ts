// The commands of the CLI, their options and their help screens. The examples in the help are run
// by the tests (tests/cli/examples.test.ts), in the folder of examples/offer.
import { VERSION } from '../version';

export interface OptionSpec {
  readonly name: string;
  readonly short?: string;
  readonly type: 'boolean' | 'string';
  /** The placeholder of the value, as the help shows it. */
  readonly value?: string;
  readonly choices?: readonly string[];
  readonly description: string;
}

export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  /** The number of positional arguments, and their names for messages. */
  readonly positionals: readonly string[];
  readonly description: string;
  readonly options: readonly OptionSpec[];
  readonly examples: readonly (readonly [string, string])[];
  readonly exits: string;
  readonly related: readonly string[];
}

export const JSON_DOCS = 'node_modules/docvane/docs/cli-json.md';

export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  { name: 'json', type: 'boolean', description: `Print one JSON document to stdout (${JSON_DOCS})` },
  { name: 'quiet', short: 'q', type: 'boolean', description: 'Print only results and errors' },
  { name: 'verbose', type: 'boolean', description: 'Print the stack trace of internal errors' },
  { name: 'help', short: 'h', type: 'boolean', description: 'Show help for the command' },
];

const RENDER_OPTIONS: readonly OptionSpec[] = [
  { name: 'locale', type: 'string', value: '<tag>', description: 'Locale of numbers, currencies and dates, such as pl-PL (default en-US)' },
  { name: 'time-zone', type: 'string', value: '<zone>', description: 'Time zone of dates, such as Europe/Warsaw (default UTC)' },
  { name: 'missing', type: 'string', value: '<error|empty>', choices: ['error', 'empty'], description: 'What a missing value does: an error (default), or nothing shown' },
];

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'inspect',
    summary: 'See which data a template needs',
    usage: 'docvane inspect <template> [options]',
    positionals: ['template'],
    description:
      'Lists the fields of the data that a Word, PowerPoint or Excel template needs, its loops and conditions, and every tag with its place. --schema prints the JSON Schema of the data instead. Problems of the template are listed, each with its place and a hint.',
    options: [{ name: 'schema', type: 'boolean', description: 'Print only the JSON Schema of the data' }],
    examples: [
      ['docvane inspect offer.docx', 'Data fields, sections and tags of the template'],
      ['docvane inspect offer.docx --schema', 'The JSON Schema of the data'],
      ['docvane inspect offer.docx --json', 'The whole result as JSON'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input, file or template error.',
    related: ['docvane validate', 'docvane render'],
  },
  {
    name: 'render',
    summary: 'Fill a template with data',
    usage: 'docvane render <template> <data.json|-> [options]',
    positionals: ['template', 'data'],
    description:
      'Fills the template with the data of a JSON file ("-" reads it from stdin) and writes the result next to the current folder as <template>-filled.<ext>, unless --output names the file. An existing file is replaced only with --force. Images in the data can be data URLs, or files given by their path relative to the folder of the data file (they must stay inside it). Images given as http(s) addresses are downloaded only with --fetch-images.',
    options: [
      { name: 'output', short: 'o', type: 'string', value: '<file>', description: 'The file to write (default <template>-filled.<ext>)' },
      { name: 'force', type: 'boolean', description: 'Replace the output file if it exists' },
      { name: 'dry-run', type: 'boolean', description: 'Render and check everything, but write nothing' },
      ...RENDER_OPTIONS,
      { name: 'fetch-images', type: 'boolean', description: 'Download images given as http(s) addresses (off by default)' },
    ],
    examples: [
      ['docvane render offer.docx data.json --dry-run', 'Check that the data fills the template, without writing'],
      ['docvane render offer.docx data.json -o offer-anna.docx', 'Write the result to offer-anna.docx'],
      ['docvane render offer.docx data.json -o offer-anna.docx --force --locale pl-PL', 'Replace it, with Polish numbers and dates'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input, file, template or data error.',
    related: ['docvane validate', 'docvane preview'],
  },
  {
    name: 'validate',
    summary: 'Check data before rendering',
    usage: 'docvane validate <template> <data.json|-> [options]',
    positionals: ['template', 'data'],
    description:
      'Checks the data of a JSON file ("-" reads it from stdin) against the template without writing anything. Every problem render would report is listed with the path of the field in the data, the place in the template and a hint. Warnings show where the data does not fit the schema of the template although render accepts it. Image files are checked like render does; addresses are not downloaded.',
    options: RENDER_OPTIONS,
    examples: [
      ['docvane validate offer.docx data.json', 'Check the data'],
      ['docvane validate offer.docx data.json --json', 'The problems as JSON'],
    ],
    exits: 'Exit codes: 0 the data is valid, 1 the data has problems, 2 usage error, 3 input, file or template error.',
    related: ['docvane inspect', 'docvane render'],
  },
  {
    name: 'preview',
    summary: 'Read a document as plain text',
    usage: 'docvane preview <document> [options]',
    positionals: ['document'],
    description:
      'Prints the text of a Word document, a PowerPoint presentation or an Excel workbook, part by part: the body, headers, footers and notes of a document; each slide and its notes; the rows of each sheet, with cells separated by tabs and formulas as =formula. Pictures show as [object]. Use it to check a result without an office application.',
    options: [],
    examples: [
      ['docvane preview offer-filled.docx', 'The text of the rendered offer'],
      ['docvane preview offer-filled.docx --json', 'The text as JSON, part by part'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input or file error.',
    related: ['docvane render'],
  },
];

export const WELCOME_EXAMPLES: readonly (readonly [string, string])[] = [
  ['docvane inspect offer.docx', 'See which data the template needs'],
  ['docvane render offer.docx data.json', 'Fill the template'],
  ['docvane validate offer.docx data.json', 'Check data before rendering'],
  ['docvane preview offer-filled.docx', 'Read the result as plain text'],
];

function optionLine(o: OptionSpec): string {
  const flag = `${o.short === undefined ? '    ' : `-${o.short}, `}--${o.name}${o.value === undefined ? '' : ` ${o.value}`}`;
  return `  ${flag.padEnd(30)}${o.description}`;
}

/** The screen of `docvane` without arguments. */
export function welcomeScreen(): string {
  const examples = WELCOME_EXAMPLES.map(([cmd, text]) => `  ${cmd.padEnd(41)}${text}`).join('\n');
  return [
    `docvane ${VERSION} - fill Word, PowerPoint and Excel templates`,
    '',
    'Common tasks:',
    examples,
    '',
    `Commands: ${COMMANDS.map((c) => c.name).join(', ')}`,
    'More:  docvane help <command>   ·   Docs: https://github.com/DevXord/docvane',
    `For scripts and AI agents: add --json to any command (${JSON_DOCS})`,
    '',
  ].join('\n');
}

/** The help screen of a command. */
export function helpScreen(spec: CommandSpec): string {
  const lines = [`docvane ${spec.name} - ${spec.summary}`, '', 'Usage:', `  ${spec.usage}`, '', wrap(spec.description, 100), ''];
  if (spec.options.length > 0) lines.push('Options:', ...spec.options.map(optionLine), '');
  lines.push('Global options:', ...GLOBAL_OPTIONS.map(optionLine), '');
  lines.push('Examples:', ...spec.examples.flatMap(([cmd, text]) => [`  ${cmd}`, `      ${text}`]), '');
  lines.push(spec.exits, `Related: ${spec.related.join(', ')}`, '');
  return lines.join('\n');
}

function wrap(text: string, width: number): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') out.push(line);
  return out.join('\n');
}
