<img src="https://raw.githubusercontent.com/DevXord/tplvane/main/assets/logo.svg" alt="" width="96" height="96">

# tplvane

[![ci](https://github.com/DevXord/tplvane/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DevXord/tplvane/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tplvane?color=0f766e&label=npm)](https://www.npmjs.com/package/tplvane)
[![node](https://img.shields.io/badge/node-%E2%89%A522-0f766e)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-MIT-0f766e)](https://github.com/DevXord/tplvane/blob/main/packages/tplvane/LICENSE)
[![docs](https://img.shields.io/badge/docs-tplvane.github.io-0f766e)](https://tplvane.github.io/)

> Fill Word, PowerPoint and Excel templates with one syntax, treating templates and data as untrusted.

Sibling project: [xlvane](https://xlvane.github.io/), the Excel library tplvane uses for workbooks. Documentation: [tplvane.github.io](https://tplvane.github.io/), with the [template syntax](https://tplvane.github.io/guide/syntax.html).

A template engine for Word, PowerPoint and Excel files, with one syntax for DOCX, PPTX and XLSX. Templates and data are treated as untrusted. MIT license, ESM only.

**Status:** 1.0.1. tplvane handles Word, PowerPoint and Excel templates: `inspect` lists their tags, loops and conditions and returns a JSON Schema of the data they need, and `render` fills them, with images, links and Markdown in documents and presentations, repeated slides, and in workbooks numbers and dates as typed cells and repeated rows whose totals follow. `validate` checks data against a template without writing a file, with the path of every problem in the data, and `templateSchema` gives the same check as a Standard Schema. `preview` returns the text of a result, and the `tplvane` command does all of this from the terminal.

```ts
import { readFileSync } from 'node:fs';
import { inspect } from 'tplvane';

const { tags, sections, schema } = inspect(readFileSync('offer.docx'));
for (const tag of tags) console.log(tag.raw, '-', tag.location.description);
// {%logo} - body, paragraph 1
// {number} - body, paragraph 2
// {customer.name} - body, paragraph 3
// …
// {#items} - body, table 1 row 2 cell 1, paragraph 1
console.log(JSON.stringify(schema, null, 2));
```

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { render } from 'tplvane';

// The offer example of the repository: see "The command line in 5 minutes" below.
const result = render(readFileSync('offer.docx'), {
  logo: readFileSync('logo.png'),
  number: '2026/11/001',
  customer: { name: 'Anna Nowak', company: 'Nowak Design' },
  date: '2026-11-06',
  items: [{ name: 'Desk', qty: 1, price: 1200, total: 1200 }, { name: 'Chair', qty: 4, price: 349.99, total: 1399.96 }],
  sum: 2599.96,
  vip: true,
  notes: '**Delivery** in 5 working days.\n\n- Assembly included',
  author: 'Jan Kowalski',
}, { locale: 'pl-PL' });
writeFileSync('offer-anna.docx', result);
```

In the template: `For {customer.name}, {customer.company}`, a table row with `{#items}{name}`, `{qty}`, `{price | currency("EUR")}` and `{total | currency("EUR")}{/items}`, `{#vip}As a VIP customer you get free delivery.{/vip}` and `{~notes}`. Expressions such as `{#total > 1000}…{/total > 1000}` and the formatters `upper`, `lower`, `capitalize`, `trim`, `default`, `number`, `percent`, `currency`, `date` and `link` are available; nothing in a template can run code. `{%logo}` inserts an image from bytes or a data URL, and `{~notes}` Markdown with the template's own heading and list styles. tplvane never downloads anything: images from addresses go through `renderAsync` with a `fetchImage` function you pass.

Tags are found however Word or LibreOffice split their text into pieces of formatting, in the main text, tables, text boxes, headers, footers, footnotes and endnotes. Problems with tags are reported together, each with its place in the document and a hint.

- [Template syntax](https://github.com/DevXord/tplvane/blob/main/docs/syntax.md)
- [Errors and warnings](https://github.com/DevXord/tplvane/blob/main/docs/errors.md)
- [Migrating from docxtemplater](https://github.com/DevXord/tplvane/blob/main/docs/migrating-from-docxtemplater.md)

The package also contains `docs/` (template syntax, errors, migrating from docxtemplater, the JSON output of the command line), the Agent Skill `skills/tplvane/SKILL.md` and `llms-full.txt` (all of it in one file), for reading without network access: after installing, they are in `node_modules/tplvane/`. Agent clients look for skills in their own folders, not in `node_modules`, so to use the skill, copy `node_modules/tplvane/skills/tplvane` into the skills folder of the client (for example `.agents/skills/tplvane`).

XLSX templates and the low-level OOXML code come from [xlvane](https://github.com/DevXord/xlvane), the sister project for working with spreadsheet files in code.

## The command line in 5 minutes

The package installs a `tplvane` command. Take the offer example of the repository, [examples/offer](https://github.com/DevXord/tplvane/tree/main/examples/offer): its data `data.json` and `logo.png`, and the template `offer.docx`, which `node scripts/make-example.mjs` writes next to them in a clone of the repository (after `npm ci`). Then run in that folder:

```bash
npx tplvane inspect offer.docx
```

It lists the data the template needs (`customer.name`, `items` with `name`, `qty`, `price`, `total`, an image `logo`, Markdown `notes`, …), its loops and conditions, and every tag with its place, such as `body, table 1 row 2 cell 1, paragraph 1`. `--schema` prints the JSON Schema of the data.

```bash
npx tplvane validate offer.docx data.json
```

It checks the data without writing anything. With a field missing or misspelt, every problem is listed with the path in the data, the place in the template and a hint; for example, with `"customer": { "nme": "Anna Nowak" }`:

```text
  1. The data has no "customer.name", which "{customer.name}" needs.
     Where: customer.name in the data; body, paragraph 3, character 5
     Fix:   Did you mean "nme"? Add "customer.name" to the data, give the tag a default (|
            default("-")), or render with { missing: "empty" }. The data has here: nme.
```

```bash
npx tplvane render offer.docx data.json
npx tplvane preview offer-filled.docx
```

`render` writes `offer-filled.docx` (`--output` names another file; an existing file is replaced only with `--force`, by a new file renamed over it, and never through a link; `--dry-run` checks without writing; `--locale pl-PL` gives Polish numbers and dates). The image `"logo": "logo.png"` is a file next to the data file: files must stay inside that folder, and images given as http(s) addresses are downloaded only with `--fetch-images`. With `--fetch-images`, every address in the data is requested, internal ones included, so use it only with data you trust. Templates, data files and stdin are read up to 256 MiB, and only from regular files. `preview` prints the text of the result, so it can be checked without Word.

To make a template from a finished document, give the texts to replace in a JSON list, such as the example's `map.json` (`[{ "find": "Anna Nowak", "tag": "customer.name" }, …]`), and run:

```bash
npx tplvane make-template offer-filled.docx map.json
```

It writes `offer-filled-template.docx`, where those texts are tags with their formatting kept, and lists what it replaced and the data the new template needs. The texts are matched exactly as `preview` shows them; see [the template syntax](docs/syntax.md#making-a-template-from-a-finished-document).

Every command takes `--json` and then prints one JSON document described in [docs/cli-json.md](docs/cli-json.md). `tplvane help <command>` shows the options and examples. Exit codes: 0 success, 1 `validate` found problems, 2 usage error, 3 input, file, template or data error.

## Trademarks

Microsoft, Word, PowerPoint and Excel are trademarks of the Microsoft group of companies. LibreOffice, docxtemplater and the other names in this document belong to their owners. tplvane is an independent project and is not affiliated with or endorsed by any of them.

## License

[MIT](LICENSE)
