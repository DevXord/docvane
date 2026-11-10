# @tplvane/mcp

An MCP server for [tplvane](https://github.com/DevXord/tplvane): tools to inspect Word, PowerPoint and Excel templates, validate data, render and read the result as text. It is read-only by default and limited to the directories given at start.

**Status:** 1.0.1, released together with tplvane in the same version.

```bash
npx @tplvane/mcp --root ./templates                 # read-only
npx @tplvane/mcp --root ./templates --allow-write   # also the render tool
```

The `tplvane-mcp` command serves the tools over stdio with the official MCP SDK. Options: `--root <dir>` (required, repeatable; an empty value is refused), `--allow-write`, `--max-file-size <bytes>` (default 50 MiB), `--max-response-chars <n>` (default 100 000; it limits the text of a result and its structured content, which is replaced by a note when it is longer). One message may be as large as a file of `--max-file-size` written as a base64 data URL; a larger one is reported on stderr and the server ends with exit code 1. Exit codes: 0 when the client closes the connection, 1 for a message that is too large, 2 for wrong arguments, 3 for a root that cannot be used. A client configuration usually runs `npx` with the arguments `["@tplvane/mcp", "--root", "/path/to/templates"]`.

## Tools

| Tool | Writes | What it does |
|---|---|---|
| `inspect_template` | no | The JSON Schema of the data a template needs, its tags with their places, warnings |
| `validate_data` | no | Checks data (inline, or a JSON file) against a template: every problem with the path of the field in the data, the place in the template and a hint |
| `preview_text` | no | The text of a document, presentation or workbook, part by part |
| `render` | yes, only with `--allow-write` | Fills a template and writes the result; replaces a file only with `overwrite: true` |
| `make_template` | yes, only with `--allow-write` | Replaces texts of a finished document with tags and writes the new template; returns the JSON Schema of its data |

Files are read and written only inside the root directories (`--root`, repeatable); relative paths start at the first one. Links that point out of the roots, files with more than one name (hard links), folders, devices and pipes are refused; on Linux the opened file is checked again, so a folder swapped for a link between the check and the opening is refused too. `render` and `make_template` write only files with the extension of the template (or document) (`.docx`, `.docm`, `.dotx`, `.dotm`, `.pptx` or `.xlsx`, after `.` and `..` are resolved), and replaces a file by renaming a new one over it, never by changing it in place, keeping its permissions. Whether a folder outside the roots exists is never told. The roots should not be writable by programs you do not trust. Images in the data must be data URLs: the server downloads nothing and reads no file on behalf of the data.

In code, `createServer(options)` returns an `McpServer` of the SDK to connect to any transport, and `createTools(sandbox)` the tools without the SDK:

```ts
import { createTools, Sandbox } from '@tplvane/mcp';

const tools = createTools(new Sandbox({ roots: ['./templates'] }));
const inspectTool = tools.find((tool) => tool.name === 'inspect_template');
console.log(inspectTool?.handler({ path: 'offer.docx' }).content[0]?.text);
```

## License

[MIT](LICENSE)
