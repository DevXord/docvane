# docvane

A template engine for Word, PowerPoint and Excel files, with one syntax for DOCX, PPTX and XLSX. Templates and data are treated as untrusted. MIT license, ESM only.

**Status:** early development, not published on npm. This version handles Word and PowerPoint templates: `inspect` lists their tags, loops and conditions and returns a JSON Schema of the data they need, and `render` fills them, with images, links and Markdown, and repeats slides in presentations. Excel templates come later.

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

XLSX templates and the low-level OOXML code come from [xlvane](https://github.com/DevXord/xlvane), the sister project for working with spreadsheet files in code.

## License

[MIT](LICENSE)
