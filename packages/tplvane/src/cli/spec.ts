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

export const JSON_DOCS = 'node_modules/tplvane/docs/cli-json.md';

export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  { name: 'json', type: 'boolean', description: `Print one JSON document to stdout (${JSON_DOCS})` },
  { name: 'quiet', short: 'q', type: 'boolean', description: 'Print only results and errors' },
  { name: 'verbose', type: 'boolean', description: 'Print the stack trace of internal errors' },
  { name: 'help', short: 'h', type: 'boolean', description: 'Show help for the command' },
];

const DELIMITERS: OptionSpec = { name: 'delimiters', type: 'string', value: '"<s> <e>"', description: 'Tag delimiters, start and end, such as "{{ }}" or "[[ ]]" (default "{ }")' };

const RENDER_OPTIONS: readonly OptionSpec[] = [
  DELIMITERS,
  { name: 'locale', type: 'string', value: '<tag>', description: 'Locale of numbers, currencies and dates, such as pl-PL (default en-US)' },
  { name: 'time-zone', type: 'string', value: '<zone>', description: 'Time zone of dates, such as Europe/Warsaw (default UTC)' },
  { name: 'missing', type: 'string', value: '<error|empty>', choices: ['error', 'empty'], description: 'What a missing value does: an error (default), or nothing shown' },
];

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'inspect',
    summary: 'See which data a template needs',
    usage: 'tplvane inspect <template> [options]',
    positionals: ['template'],
    description:
      'Lists the fields of the data that a Word, PowerPoint or Excel template needs, its loops and conditions, and every tag with its place. --schema prints the JSON Schema of the data instead. Problems of the template are listed, each with its place and a hint.',
    options: [{ name: 'schema', type: 'boolean', description: 'Print only the JSON Schema of the data' }, DELIMITERS],
    examples: [
      ['tplvane inspect offer.docx', 'Data fields, sections and tags of the template'],
      ['tplvane inspect offer.docx --schema', 'The JSON Schema of the data'],
      ['tplvane inspect offer.docx --json', 'The whole result as JSON'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input, file or template error.',
    related: ['tplvane validate', 'tplvane render'],
  },
  {
    name: 'render',
    summary: 'Fill a template with data',
    usage: 'tplvane render <template> <data.json|-> [options]',
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
      ['tplvane render offer.docx data.json --dry-run', 'Check that the data fills the template, without writing'],
      ['tplvane render offer.docx data.json -o offer-anna.docx', 'Write the result to offer-anna.docx'],
      ['tplvane render offer.docx data.json -o offer-anna.docx --force --locale pl-PL', 'Replace it, with Polish numbers and dates'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input, file, template or data error.',
    related: ['tplvane validate', 'tplvane preview'],
  },
  {
    name: 'validate',
    summary: 'Check data before rendering',
    usage: 'tplvane validate <template> <data.json|-> [options]',
    positionals: ['template', 'data'],
    description:
      'Checks the data of a JSON file ("-" reads it from stdin) against the template without writing anything. Every problem render would report is listed with the path of the field in the data, the place in the template and a hint. Warnings show where the data does not fit the schema of the template although render accepts it. Image files are checked like render does; addresses are not downloaded.',
    options: RENDER_OPTIONS,
    examples: [
      ['tplvane validate offer.docx data.json', 'Check the data'],
      ['tplvane validate offer.docx data.json --json', 'The problems as JSON'],
    ],
    exits: 'Exit codes: 0 the data is valid, 1 the data has problems, 2 usage error, 3 input, file or template error.',
    related: ['tplvane inspect', 'tplvane render'],
  },
  {
    name: 'preview',
    summary: 'Read a document as plain text',
    usage: 'tplvane preview <document> [options]',
    positionals: ['document'],
    description:
      'Prints the text of a Word document, a PowerPoint presentation or an Excel workbook, part by part: the body, headers, footers and notes of a document; each slide and its notes; the rows of each sheet, with cells separated by tabs, and a formula as =formula when the file stores no result for it (tplvane removes the stored results of the formulas it renders). In documents, pictures, footnote marks and other objects show as [object]; pictures in presentations are left out. Use it to check a result without an office application.',
    options: [],
    examples: [
      ['tplvane preview offer-filled.docx', 'The text of the rendered offer'],
      ['tplvane preview offer-filled.docx --json', 'The text as JSON, part by part'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input or file error.',
    related: ['tplvane render', 'tplvane make-template'],
  },
  {
    name: 'make-template',
    summary: 'Turn the texts of a finished document into tags',
    usage: 'tplvane make-template <document> <map.json|-> [options]',
    positionals: ['document', 'map'],
    description:
      'Replaces texts of a finished Word document, PowerPoint presentation or Excel workbook with tags, keeping their formatting, and writes the template as <document>-template.<ext>, unless --output names the file. The map is a JSON list of entries ("-" reads it from stdin), such as [{"find": "Anna Nowak", "tag": "customer.name"}]: "find" is a text as tplvane preview shows it, matched exactly within one paragraph or cell; "tag" is the content of one tag, or "with" is template text such as "{#items}{name}"; "where" limits an entry to a part (body, header, footer, slide 2, sheet Data) and "occurrence" to one match. Every entry must match, and the result must be a valid template. An existing file is replaced only with --force.',
    options: [
      { name: 'output', short: 'o', type: 'string', value: '<file>', description: 'The file to write (default <document>-template.<ext>)' },
      { name: 'force', type: 'boolean', description: 'Replace the output file if it exists' },
      { name: 'dry-run', type: 'boolean', description: 'Check the map and the result, but write nothing' },
      DELIMITERS,
    ],
    examples: [
      ['tplvane make-template offer-filled.docx map.json --dry-run', 'Check what the map replaces, without writing'],
      ['tplvane make-template offer-filled.docx map.json -o my-offer.docx', 'Write the new template to my-offer.docx'],
    ],
    exits: 'Exit codes: 0 success, 2 usage error, 3 input, file, map or template error.',
    related: ['tplvane preview', 'tplvane inspect'],
  },
];

export const WELCOME_EXAMPLES: readonly (readonly [string, string])[] = [
  ['tplvane inspect offer.docx', 'See which data the template needs'],
  ['tplvane render offer.docx data.json', 'Fill the template'],
  ['tplvane validate offer.docx data.json', 'Check data before rendering'],
  ['tplvane preview offer-filled.docx', 'Read the result as plain text'],
  ['tplvane make-template offer-filled.docx map.json', 'Make a template from a finished document'],
];

function optionLine(o: OptionSpec): string {
  const flag = `${o.short === undefined ? '    ' : `-${o.short}, `}--${o.name}${o.value === undefined ? '' : ` ${o.value}`}`;
  return `  ${flag.padEnd(30)}${o.description}`;
}

/** The screen of `tplvane` without arguments. */
export function welcomeScreen(): string {
  const examples = WELCOME_EXAMPLES.map(([cmd, text]) => `  ${cmd.padEnd(51)}${text}`).join('\n');
  return [
    `tplvane ${VERSION} - fill Word, PowerPoint and Excel templates`,
    '',
    'Common tasks:',
    examples,
    '',
    `Commands: ${COMMANDS.map((c) => c.name).join(', ')}`,
    'More:  tplvane help <command>   ·   Docs: https://github.com/DevXord/tplvane',
    `For scripts and AI agents: add --json to any command (${JSON_DOCS}),`,
    'or run the MCP server of the package @tplvane/mcp: npx @tplvane/mcp --root <dir>',
    '',
  ].join('\n');
}

/** The help screen of a command. */
export function helpScreen(spec: CommandSpec): string {
  const lines = [`tplvane ${spec.name} - ${spec.summary}`, '', 'Usage:', `  ${spec.usage}`, '', wrap(spec.description, 100), ''];
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
