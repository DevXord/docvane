#!/usr/bin/env node
// The tplvane-mcp command: serves the tplvane MCP server over stdio. Options as `xlvane mcp`:
// --root <dir> (required, repeatable), --allow-write, --max-file-size <bytes>,
// --max-response-chars <n>. stdout carries the protocol, so messages go to stderr. Exit codes:
// 0 when the client closes the connection, 2 for wrong arguments, 3 for a root that cannot be used.
import process from 'node:process';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { resolve } from 'node:path';
import { isTvError } from 'tplvane';
import { createServer } from './server';
import { VERSION } from './version';

const HELP = `tplvane-mcp ${VERSION} - the tplvane MCP server, over stdio

Usage:
  tplvane-mcp --root <dir> [--root <dir> ...] [options]

Serves the tools inspect_template, validate_data and preview_text, and render with --allow-write,
for the files inside the root directories. Relative paths in tool calls start at the first root.

Options:
      --root <dir>              A directory the tools may use (required, repeatable)
      --allow-write             Add the render tool, which writes files inside the roots
      --max-file-size <bytes>   The largest file the tools read (default 52428800)
      --max-response-chars <n>  The longest text a tool returns (default 100000)
  -h, --help                    Show this help
  -v, --version                 Show the version

Exit codes: 0 the client closed the connection, 2 wrong arguments, 3 a root that cannot be used.
`;

function fail(message: string, code: number): void {
  process.stderr.write(`tplvane-mcp: ${message}\n`);
  process.exitCode = code;
}

function positive(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} needs a positive whole number, not "${String(value)}".`);
  return n;
}

async function main(): Promise<void> {
  let values: Record<string, string | boolean | undefined | string[]>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: { root: { type: 'string', multiple: true }, 'allow-write': { type: 'boolean' }, 'max-file-size': { type: 'string' }, 'max-response-chars': { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
      strict: true,
      allowPositionals: false,
    }).values as Record<string, string | boolean | undefined | string[]>;
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)} Run "tplvane-mcp --help".`, 2);
    return;
  }
  if (values['help'] === true) {
    process.stdout.write(HELP);
    return;
  }
  if (values['version'] === true) {
    process.stdout.write(`tplvane-mcp ${VERSION}\n`);
    return;
  }
  const roots = (values['root'] as string[] | undefined) ?? [];
  if (roots.length === 0) {
    fail('give at least one directory with --root <dir>. Run "tplvane-mcp --help".', 2);
    return;
  }
  let server;
  try {
    const maxFileBytes = positive(values['max-file-size'] as string | undefined, 'max-file-size');
    const maxResponseChars = positive(values['max-response-chars'] as string | undefined, 'max-response-chars');
    server = createServer({ roots, allowWrite: values['allow-write'] === true, ...(maxFileBytes === undefined ? {} : { maxFileBytes }), ...(maxResponseChars === undefined ? {} : { maxResponseChars }) });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), isTvError(error) ? 3 : 2);
    return;
  }
  // One message can carry a file of --max-file-size as a base64 data URL; above the SDK's default
  // of 10 MB the transport would close without a word, so the size is set and the error told.
  const maxBufferSize = Math.max(10 * 1024 * 1024, Math.ceil(((positive(values['max-file-size'] as string | undefined, 'max-file-size') ?? 50 * 1024 * 1024) * 4) / 3) + 1024 * 1024);
  const transport = new StdioServerTransport(undefined, undefined, { maxBufferSize });
  await server.connect(transport);
  const onerror = transport.onerror;
  transport.onerror = (error: Error) => {
    process.stderr.write(`tplvane-mcp: ${error.message} (messages may have at most ${String(maxBufferSize)} bytes)\n`);
    process.exitCode = 1;
    onerror?.(error);
  };
  process.stderr.write(`tplvane-mcp ${VERSION}: serving ${roots.map((r) => resolve(r)).join(', ')}${values['allow-write'] === true ? ' (read and write)' : ' (read-only)'}\n`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error), 3));
