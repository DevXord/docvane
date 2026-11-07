---
name: docvane
description: Fill Word (.docx), PowerPoint (.pptx) and Excel (.xlsx) templates with data using the docvane library or its docvane command line - inspect which data a template needs, validate data, render, and read the result as text. Use when a task involves filling document templates with tags such as {customer.name} or {#items}...{/items}.
license: MIT
compatibility: Node.js 22 or later. The library works on Uint8Array and has no Node.js dependencies; the command line needs Node.js.
---

# docvane: filling templates

docvane fills templates made in Word, PowerPoint, Excel or LibreOffice with data. One tag syntax for all three formats. Templates and data are treated as untrusted: tags cannot run code, values are escaped, the size of the result is limited, and nothing is downloaded unless you pass a function (library) or `--fetch-images` (command line).

| Way | When | Start |
|---|---|---|
| Library `docvane` | You write JavaScript or TypeScript | `npm install docvane` |
| Command line `docvane` | You run shell commands | `npx docvane help` |

## Recommended order of work

1. **Inspect the template** before preparing data: `inspect` returns the JSON Schema of the data, every tag with its place (`body, table 1 row 2 cell 1, paragraph 1`, `slide 3, shape "Title 1"`, `sheet Data, cell C5`) and the loops and conditions.
2. **Build the data** to fit the schema.
3. **Validate** the data: every problem comes with the path of the field (`items[1].name`), the place in the template and a hint that lists the fields that are there.
4. **Render**, then **read the result as text** with `preview` to check it.

## Command line

```bash
npx docvane inspect offer.docx              # data fields, sections, tags
npx docvane inspect offer.docx --schema     # the JSON Schema of the data
npx docvane validate offer.docx data.json   # exit code 1 when the data has problems
npx docvane render offer.docx data.json -o offer-anna.docx
npx docvane preview offer-anna.docx         # the text of the result
```

Add `--json` to any command for one JSON document (described in `node_modules/docvane/docs/cli-json.md`). `render` never replaces a file without `--force`; `--dry-run` checks without writing. Image values in the data can be files next to the data file (`"logo": "logo.png"`) or data URLs.

## Library

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { inspect, preview, render, validate } from 'docvane';

const template = readFileSync('offer.docx');
const { schema } = inspect(template);
const data = { customer: { name: 'Anna Nowak' }, items: [{ name: 'Desk', price: 1200 }] };

const check = validate(template, data);
if (!check.valid) for (const e of check.errors) console.log(e.details['dataPath'], e.message, e.hint);

const result = render(template, data, { locale: 'pl-PL' });
writeFileSync('offer-anna.docx', result);
console.log(preview(result).text);
```

## Template syntax

| Tag | Meaning |
|---|---|
| `{customer.name}` | A value |
| `{total \| currency("PLN")}` | A value through formatters: `upper`, `lower`, `capitalize`, `trim`, `default("-")`, `number(2)`, `percent`, `currency("EUR")`, `date("long")`, `link` |
| `{#items}…{/items}` | Repeats for each item of a list; shows once for a true value |
| `{^items}…{/items}` | Shows when the value is missing, false or an empty list |
| `{#total > 1000}…{/total > 1000}` | A condition: `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `\|\|`, `!` |
| `{.}` | The current item of a list of plain values |
| `{%logo}` | An image (bytes or a data URL; Word and PowerPoint) |
| `{~summary}` | Markdown with the template's own styles (Word and PowerPoint) |

What a loop repeats follows from where its tags are: within a paragraph, whole paragraphs (tags alone in their paragraphs), table rows, slides (tags each alone in a shape) or sheet rows (tags in different cells of a sheet). In Excel, a cell holding one value tag keeps the type of the value, and totals below repeated rows grow to cover the copies.

## Errors

Errors have a stable code (`DV_E_*`), a place in the template and a hint. A template with problems gives `DV_E_TEMPLATE_INVALID`, data with problems `DV_E_DATA_INVALID`, each listing every problem in `errors`. The codes are described in `node_modules/docvane/docs/errors.md`; the template syntax in `docs/syntax.md` next to it, and the differences from docxtemplater in `docs/migrating-from-docxtemplater.md`. `node_modules/docvane/llms-full.txt` has all of it in one file.
