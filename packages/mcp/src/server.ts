// The tplvane MCP server (D-055): the tools of ./tools.ts registered on an McpServer of the
// official MCP SDK. Their input schemas are the JSON Schemas of the tools, which the SDK uses to
// list the tools and to check the arguments of every call.
import { fromJsonSchema, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server';
import { Sandbox, type SandboxOptions } from './sandbox';
import { createTools, type ToolOptions } from './tools';
import { VERSION } from './version';

/**
 * Options of {@link createServer}: the root directories and limits of the sandbox, and the
 * limits of the tools.
 *
 * @example
 * ```ts
 * import { createServer, type ServerOptions } from '@tplvane/mcp';
 *
 * const options: ServerOptions = { roots: ['./templates'], allowWrite: true, maxResponseChars: 50_000 };
 * console.log(createServer(options) !== undefined);
 * ```
 */
export interface ServerOptions extends SandboxOptions, ToolOptions {}

/**
 * Creates the tplvane MCP server with its tools: `inspect_template`, `validate_data` and
 * `preview_text`, and `render` when `allowWrite` is set. Connect it to a transport of the MCP SDK,
 * for example stdio, as the `tplvane-mcp` command does.
 *
 * @example
 * ```ts
 * import { createServer } from '@tplvane/mcp';
 * import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
 *
 * const server = createServer({ roots: ['./templates'] });
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createServer(options: ServerOptions): McpServer {
  const sandbox = new Sandbox(options);
  const server = new McpServer({ name: 'tplvane', version: VERSION });
  for (const tool of createTools(sandbox, options)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, idempotentHint: tool.readOnly, openWorldHint: false },
      },
      (args) => {
        const result = tool.handler(args as Readonly<Record<string, unknown>>);
        return { content: result.content.map((c) => ({ ...c })), structuredContent: { ...result.structuredContent }, ...(result.isError === true ? { isError: true } : {}) };
      },
    );
  }
  return server;
}
