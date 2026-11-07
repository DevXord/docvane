# @docvane/mcp

An MCP server for [docvane](https://github.com/DevXord/docvane): tools to inspect Word, PowerPoint and Excel templates, validate data, render and read the result as text. It is read-only by default and limited to the directories given at start.

**Status:** early development. The tools and their file access are done and tested; the server that serves them over MCP (stdio) waits for the official MCP SDK to be added as a dependency.

## Tools

| Tool | Writes | What it does |
|---|---|---|
| `inspect_template` | no | The JSON Schema of the data a template needs, its tags with their places, warnings |
| `validate_data` | no | Checks data (inline, or a JSON file) against a template: every problem with the path of the field in the data, the place in the template and a hint |
| `preview_text` | no | The text of a document, presentation or workbook, part by part |
| `render` | yes, only with `--allow-write` | Fills a template and writes the result; replaces a file only with `overwrite: true` |

Files are read and written only inside the root directories (`--root`, repeatable); relative paths start at the first one, and links that point out of the roots are refused. Images in the data must be data URLs: the server downloads nothing and reads no file on behalf of the data.

```ts
import { createTools, Sandbox } from '@docvane/mcp';

const tools = createTools(new Sandbox({ roots: ['./templates'] }));
const inspectTool = tools.find((tool) => tool.name === 'inspect_template');
console.log(inspectTool?.handler({ path: 'offer.docx' }).content[0]?.text);
```

## License

[MIT](LICENSE)
