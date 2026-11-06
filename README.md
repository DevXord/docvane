# docvane

A template engine for Word, PowerPoint and Excel files, with one syntax for DOCX, PPTX and XLSX. Templates and data are treated as untrusted. MIT license, ESM only.

**Status:** early development; nothing is published on npm. `inspect` reads Word, PowerPoint and Excel templates and returns their tags and a JSON Schema of the data, and `render` fills them: with images, links and Markdown in documents and presentations, repeated slides, and in workbooks typed values and repeated rows whose totals follow. See [the template syntax](docs/syntax.md) and [the error catalogue](docs/errors.md).

## Packages

| Package | Purpose |
|---|---|
| [`docvane`](packages/docvane) | The template engine |
| [`@docvane/mcp`](packages/mcp) | MCP server |

## Development

Requires Node.js 22.18 or later in the 22 line, 24.11 or later in the 24 line, or 26 and later.

```bash
npm install
npm test
npm run check:pkg
```

| Command | What it does |
|---|---|
| `npm test` | Unit, corpus, documentation and policy tests (Vitest) |
| `npm run fuzz` | Property tests with many runs |
| `npm run test:libreoffice` | Renders test documents and checks that LibreOffice opens them (needs LibreOffice; `DV_SOFFICE` gives the path of `soffice`) |
| `npm run build` | Builds the packages with tsdown |
| `npm run typecheck` | TypeScript check of sources and tests |
| `npm run check:pkg` | Build, publint, @arethetypeswrong/cli and loading every built file |

## License

[MIT](LICENSE)
