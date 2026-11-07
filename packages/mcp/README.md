# @docvane/mcp

An MCP server for [docvane](https://github.com/DevXord/docvane): tools to inspect Word, PowerPoint and Excel templates, validate data, render and read the result as text. It is read-only by default and limited to the directories given at start.

**Status:** early development, not published on npm.

```bash
npx @docvane/mcp --root ./templates                 # read-only
npx @docvane/mcp --root ./templates --allow-write   # also the render tool
```

The `docvane-mcp` command serves the tools over stdio with the official MCP SDK. Options: `--root <dir>` (required, repeatable), `--allow-write`, `--max-file-size <bytes>` (default 50 MiB), `--max-response-chars <n>` (default 100 000). Exit codes: 0 when the client closes the connection, 2 for wrong arguments, 3 for a root that cannot be used. A client configuration usually runs `npx` with the arguments `["@docvane/mcp", "--root", "/path/to/templates"]`.

## Tools

| Tool | Writes | What it does |
|---|---|---|
| `inspect_template` | no | The JSON Schema of the data a template needs, its tags with their places, warnings |
| `validate_data` | no | Checks data (inline, or a JSON file) against a template: every problem with the path of the field in the data, the place in the template and a hint |
| `preview_text` | no | The text of a document, presentation or workbook, part by part |
| `render` | yes, only with `--allow-write` | Fills a template and writes the result; replaces a file only with `overwrite: true` |

Files are read and written only inside the root directories (`--root`, repeatable); relative paths start at the first one. Links that point out of the roots, files with more than one name (hard links), folders, devices and pipes are refused. `render` writes only files with the extension of the template, and replaces a file by renaming a new one over it, never by changing it in place. Images in the data must be data URLs: the server downloads nothing and reads no file on behalf of the data.

In code, `createServer(options)` returns an `McpServer` of the SDK to connect to any transport, and `createTools(sandbox)` the tools without the SDK:

```ts
import { createTools, Sandbox } from '@docvane/mcp';

const tools = createTools(new Sandbox({ roots: ['./templates'] }));
const inspectTool = tools.find((tool) => tool.name === 'inspect_template');
console.log(inspectTool?.handler({ path: 'offer.docx' }).content[0]?.text);
```

## License

[MIT](LICENSE)
