// The tools of the docvane MCP server (D-055), independent of the MCP SDK: each has a name, a
// description, a JSON Schema of its input and a handler that returns text and structured content.
// The server (./server.ts, once the SDK is added) only registers them. Read-only tools use the
// files of the roots; `render` writes only with --allow-write.
import { DvError, inspect, isDvError, preview, render, validate, type DvWarning, type JsonSchema } from 'docvane';
import { Sandbox } from './sandbox';

/**
 * The result of a tool, in the shape of an MCP tool result: text for the model, structured
 * content for programs, and `isError` for a docvane error (its JSON is in `structuredContent.error`).
 *
 * @example
 * ```ts
 * import { createTools, Sandbox, type ToolResult } from '@docvane/mcp';
 *
 * const [inspectTool] = createTools(new Sandbox({ roots: ['./templates'] }));
 * const result: ToolResult | undefined = inspectTool?.handler({ path: 'offer.docx' });
 * console.log(result?.isError === true ? 'error' : result?.structuredContent['format']);
 * ```
 */
export interface ToolResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
}

/**
 * A tool of the server: its name, description, input schema and handler.
 *
 * @example
 * ```ts
 * import { createTools, Sandbox, type Tool } from '@docvane/mcp';
 *
 * const tools: Tool[] = createTools(new Sandbox({ roots: ['./templates'] }));
 * console.log(tools.map((tool) => `${tool.name}${tool.readOnly ? '' : ' (writes)'}`));
 * ```
 */
export interface Tool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema & { readonly additionalProperties?: boolean };
  /** True for tools that do not change files. */
  readonly readOnly: boolean;
  readonly handler: (args: Readonly<Record<string, unknown>>) => ToolResult;
}

/**
 * Options of {@link createTools}.
 *
 * @example
 * ```ts
 * import { createTools, Sandbox, type ToolOptions } from '@docvane/mcp';
 *
 * const options: ToolOptions = { maxResponseChars: 20_000 };
 * console.log(createTools(new Sandbox({ roots: ['.'] }), options).length);
 * ```
 */
export interface ToolOptions {
  /** The longest text a tool returns; longer text is cut with a note. Default 100 000 characters. */
  readonly maxResponseChars?: number;
}

const str = (args: Readonly<Record<string, unknown>>, key: string): string => {
  const v = args[key];
  if (typeof v !== 'string' || v === '') throw new DvError('DV_E_USAGE', `The argument "${key}" must be a non-empty string.`, { hint: `Pass "${key}" as the path of a file inside the root directories.`, details: { argument: key } });
  return v;
};

function errorResult(error: unknown): ToolResult {
  const dv = isDvError(error) ? error : new DvError('DV_E_INTERNAL', `Internal error: ${error instanceof Error ? error.message : String(error)}`, { hint: 'This is a bug in docvane; please report it.', cause: error });
  const json = dv.toJSON();
  const lines = [`Error ${dv.code}: ${dv.message}`];
  for (const e of dv.errors) lines.push(`- ${e.code}: ${e.message} Where: ${[e.details['dataPath'], e.location.description].filter((x) => typeof x === 'string' && x !== '').join('; ') || '-'}. Fix: ${e.hint}`);
  if (dv.errors.length === 0) lines.push(`Fix: ${dv.hint}`);
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { error: json }, isError: true };
}

function warningLines(warnings: readonly DvWarning[]): string[] {
  return warnings.map((w) => `Warning ${w.code}: ${w.message}${w.location.description === undefined ? '' : ` Where: ${w.location.description}.`}`);
}

/** The data of a call: `data` given inline, or `dataPath` naming a JSON file inside the roots. */
function dataOf(sandbox: Sandbox, args: Readonly<Record<string, unknown>>): unknown {
  if (args['data'] !== undefined) return args['data'];
  const path = str(args, 'dataPath');
  const text = new TextDecoder().decode(sandbox.read(path)).replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new DvError('DV_E_INVALID_INPUT', `The data in ${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`, { hint: 'Fix the JSON, or pass the data inline as "data".', details: { path }, cause });
  }
}

const DATA_INPUT = {
  data: { description: 'The data as a JSON value (usually an object). Give either data or dataPath.' },
  dataPath: { type: 'string', description: 'A JSON file with the data, inside the root directories. Give either data or dataPath.' },
} as const;

/**
 * The tools of the docvane MCP server for the given sandbox: `inspect_template`, `validate_data`
 * and `preview_text`, and `render` only when the sandbox allows writing. Every handler returns a
 * result instead of throwing; docvane errors come back with `isError` and the error as JSON.
 *
 * @example
 * ```ts
 * import { createTools, Sandbox } from '@docvane/mcp';
 *
 * const tools = createTools(new Sandbox({ roots: ['./templates'], allowWrite: true }));
 * const validateTool = tools.find((tool) => tool.name === 'validate_data');
 * const result = validateTool?.handler({ template: 'offer.docx', data: { customer: { name: 'Anna' } } });
 * console.log(result?.structuredContent['valid']);
 * ```
 */
export function createTools(sandbox: Sandbox, options: ToolOptions = {}): Tool[] {
  const max = options.maxResponseChars ?? 100_000;
  const cut = (text: string): string => (text.length <= max ? text : `${text.slice(0, max)}\n[cut: ${String(text.length - max)} more characters; read less at a time]`);
  const run = (fn: () => ToolResult): ToolResult => {
    try {
      return fn();
    } catch (error) {
      return errorResult(error);
    }
  };
  const tools: Tool[] = [
    {
      name: 'inspect_template',
      title: 'Inspect a template',
      description:
        'Reads a Word (.docx), PowerPoint (.pptx) or Excel (.xlsx) template and returns the JSON Schema of the data it needs, its tags with their places, its loops and conditions, and warnings. Problems of the template are returned as an error listing each one with its place and a hint.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The template file, inside the root directories.' } }, required: ['path'], additionalProperties: false },
      readOnly: true,
      handler: (args) =>
        run(() => {
          const result = inspect(sandbox.read(str(args, 'path')));
          const text = [`Format: ${result.format}. ${String(result.tags.length)} tags.`, 'JSON Schema of the data:', JSON.stringify(result.schema, null, 2), ...warningLines(result.warnings)].join('\n');
          return {
            content: [{ type: 'text', text: cut(text) }],
            structuredContent: { format: result.format, schema: result.schema, tags: result.tags.map((t) => ({ raw: t.raw, kind: t.kind, path: t.path, where: t.location.description ?? '' })), warnings: result.warnings },
          };
        }),
    },
    {
      name: 'validate_data',
      title: 'Validate data for a template',
      description:
        'Checks data against a template without writing anything. Returns valid, and every problem render would report with the path of the field in the data (dataPath, pointer), the place in the template and a hint listing the fields that are there; warnings show where the data does not fit the schema although render accepts it.',
      inputSchema: {
        type: 'object',
        properties: { template: { type: 'string', description: 'The template file, inside the root directories.' }, ...DATA_INPUT, missing: { type: 'string', description: '"error" (default) or "empty": what a missing value does.' } },
        required: ['template'],
        additionalProperties: false,
      } as never,
      readOnly: true,
      handler: (args) =>
        run(() => {
          const missing = args['missing'] === 'empty' ? 'empty' : 'error';
          const result = validate(sandbox.read(str(args, 'template')), dataOf(sandbox, args), { missing });
          const errors = result.errors.map((e) => ({ code: e.code, message: e.message, dataPath: e.details['dataPath'] ?? null, pointer: e.details['pointer'] ?? null, where: e.location.description ?? '', hint: e.hint }));
          const text = result.valid ? 'Valid: the data has everything the template needs.' : [`Invalid: ${String(errors.length)} problems.`, ...errors.map((e) => `- ${e.code} at ${String(e.dataPath ?? '?')} (${e.where}): ${e.message} Fix: ${e.hint}`)].join('\n');
          return { content: [{ type: 'text', text: cut([text, ...warningLines(result.warnings)].join('\n')) }], structuredContent: { valid: result.valid, errors, warnings: result.warnings } };
        }),
    },
    {
      name: 'preview_text',
      title: 'Read a document as text',
      description: 'Returns the text of a Word document, a PowerPoint presentation or an Excel workbook, part by part (body, headers, slides and notes, sheets as rows with tab-separated cells), to check a rendered result.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The document, inside the root directories.' } }, required: ['path'], additionalProperties: false },
      readOnly: true,
      handler: (args) =>
        run(() => {
          const result = preview(sandbox.read(str(args, 'path')));
          return { content: [{ type: 'text', text: cut(result.text) }], structuredContent: { format: result.format, parts: result.parts } };
        }),
    },
  ];
  if (sandbox.allowWrite) {
    tools.push({
      name: 'render',
      title: 'Fill a template',
      description:
        'Fills a template with data and writes the result inside the root directories. An existing file is replaced only with overwrite: true. Images in the data must be data URLs; the server downloads nothing. Problems of the data are returned as an error listing each one with the path of the field and a hint; nothing is written then.',
      inputSchema: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'The template file, inside the root directories.' },
          ...DATA_INPUT,
          output: { type: 'string', description: 'The file to write, inside the root directories, with the extension of the template.' },
          overwrite: { type: 'boolean', description: 'Replace the output file if it exists. Default false.' },
          locale: { type: 'string', description: 'BCP 47 locale of numbers and dates, such as pl-PL. Default en-US.' },
          timeZone: { type: 'string', description: 'IANA time zone of dates, such as Europe/Warsaw. Default UTC.' },
        },
        required: ['template', 'output'],
        additionalProperties: false,
      } as never,
      readOnly: false,
      handler: (args) =>
        run(() => {
          const output = str(args, 'output');
          const warnings: DvWarning[] = [];
          const options = {
            ...(typeof args['locale'] === 'string' ? { locale: args['locale'] } : {}),
            ...(typeof args['timeZone'] === 'string' ? { timeZone: args['timeZone'] } : {}),
            onWarning: (w: DvWarning) => warnings.push(w),
          };
          const bytes = render(sandbox.read(str(args, 'template')), dataOf(sandbox, args), options);
          sandbox.write(output, bytes, args['overwrite'] === true);
          return { content: [{ type: 'text', text: [`Wrote ${output} (${String(bytes.length)} bytes). Check it with preview_text.`, ...warningLines(warnings)].join('\n') }], structuredContent: { output, bytes: bytes.length, warnings } };
        }),
    });
  }
  return tools;
}

