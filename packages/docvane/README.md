# docvane

A template engine for Word, PowerPoint and Excel files, with one syntax for DOCX, PPTX and XLSX. Templates and data are treated as untrusted. MIT license, ESM only.

**Status:** early development, not published on npm. This version handles Word, PowerPoint and Excel templates: `inspect` lists their tags, loops and conditions and returns a JSON Schema of the data they need, and `render` fills them, with images, links and Markdown in documents and presentations, repeated slides, and in workbooks numbers and dates as typed cells and repeated rows whose totals follow. `validate` checks data against a template without writing a file, with the path of every problem in the data, and `templateSchema` gives the same check as a Standard Schema. `preview` returns the text of a result, and the `docvane` command does all of this from the terminal.

```ts
import { readFileSync } from 'node:fs';
import { inspect } from 'docvane';

const { tags, sections, schema } = inspect(readFileSync('offer.docx'));
for (const tag of tags) console.log(tag.raw, '-', tag.location.description);
// {customer.name} - body, paragraph 1
// {#items} - body, table 1 row 2 cell 1, paragraph 1
console.log(JSON.stringify(schema, null, 2));
```

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { render } from 'docvane';

const result = render(readFileSync('offer.docx'), {
  customer: { name: 'Anna Nowak' },
  items: [{ name: 'Desk', price: 1200 }, { name: 'Chair', price: 349.99 }],
  isVip: true,
}, { locale: 'pl-PL' });
writeFileSync('offer-anna.docx', result);
```

In the template: `Dear {customer.name}`, a table row with `{#items}{name}` and `{price | currency("PLN")}{/items}`, and `{#isVip}Thank you for being a VIP.{/isVip}`. Expressions such as `{#total > 1000}…{/total > 1000}` and the formatters `upper`, `lower`, `capitalize`, `trim`, `default`, `number`, `percent`, `currency`, `date` and `link` are available; nothing in a template can run code. `{%logo}` inserts an image from bytes or a data URL, and `{~summary}` Markdown with the template's own heading and list styles. docvane never downloads anything: images from addresses go through `renderAsync` with a `fetchImage` function you pass.

Tags are found however Word or LibreOffice split their text into pieces of formatting, in the main text, tables, text boxes, headers, footers, footnotes and endnotes. Problems with tags are reported together, each with its place in the document and a hint.

- [Template syntax](https://github.com/DevXord/docvane/blob/main/docs/syntax.md)
- [Errors and warnings](https://github.com/DevXord/docvane/blob/main/docs/errors.md)
- [Migrating from docxtemplater](https://github.com/DevXord/docvane/blob/main/docs/migrating-from-docxtemplater.md)

The package also contains `docs/` (template syntax, errors, migrating from docxtemplater, the JSON output of the command line), the Agent Skill `skills/docvane/SKILL.md` and `llms-full.txt` (all of it in one file), for reading without network access: after installing, they are in `node_modules/docvane/`. Agent clients look for skills in their own folders, not in `node_modules`, so to use the skill, copy `node_modules/docvane/skills/docvane` into the skills folder of the client (for example `.agents/skills/docvane`).

XLSX templates and the low-level OOXML code come from [xlvane](https://github.com/DevXord/xlvane), the sister project for working with spreadsheet files in code.

## The command line in 5 minutes

The package installs a `docvane` command. Take the offer template of the repository, [examples/offer](https://github.com/DevXord/docvane/tree/main/examples/offer): `offer.docx`, its data `data.json` and `logo.png`, and run in their folder:

```bash
npx docvane inspect offer.docx
```

It lists the data the template needs (`customer.name`, `items` with `name`, `qty`, `price`, `total`, an image `logo`, Markdown `notes`, …), its loops and conditions, and every tag with its place, such as `body, table 1 row 2 cell 1, paragraph 1`. `--schema` prints the JSON Schema of the data.

```bash
npx docvane validate offer.docx data.json
```

It checks the data without writing anything. With a field missing or misspelt, every problem is listed with the path in the data, the place in the template and a hint:

```text
  1. The data has no "customer.name", which "{customer.name}" needs.
     Where: customer.name in the data; body, paragraph 3, character 5
     Fix:   Did you mean "nme"? Add "customer.name" to the data, give the tag a default (|
            default("-")), or render with { missing: "empty" }. The data has here: nme.
```

```bash
npx docvane render offer.docx data.json
npx docvane preview offer-filled.docx
```

`render` writes `offer-filled.docx` (`--output` names another file; an existing file is replaced only with `--force`; `--dry-run` checks without writing; `--locale pl-PL` gives Polish numbers and dates). The image `"logo": "logo.png"` is a file next to the data file: files must stay inside that folder, and images given as http(s) addresses are downloaded only with `--fetch-images`. `preview` prints the text of the result, so it can be checked without Word.

Every command takes `--json` and then prints one JSON document described in [docs/cli-json.md](docs/cli-json.md). `docvane help <command>` shows the options and examples. Exit codes: 0 success, 1 `validate` found problems, 2 usage error, 3 input, file, template or data error.

## License

[MIT](LICENSE)
