# docvane

A template engine for Word, PowerPoint and Excel files, with one syntax for DOCX, PPTX and XLSX. Templates and data are treated as untrusted. MIT license, ESM only.

**Status:** early development, not published on npm. This version reads Word templates: `inspect` lists their tags, loops and conditions and returns a JSON Schema of the data they need. Filling templates comes next.

```ts
import { readFileSync } from 'node:fs';
import { inspect } from 'docvane';

const { tags, sections, schema } = inspect(readFileSync('offer.docx'));
for (const tag of tags) console.log(tag.raw, '-', tag.location.description);
// {customer.name} - body, paragraph 1
// {#items} - body, table 1 row 2 cell 1, paragraph 1
console.log(JSON.stringify(schema, null, 2));
```

Tags are found however Word or LibreOffice split their text into pieces of formatting, in the main text, tables, text boxes, headers, footers, footnotes and endnotes. Problems with tags are reported together, each with its place in the document and a hint.

- [Template syntax](https://github.com/DevXord/docvane/blob/main/docs/syntax.md)
- [Errors and warnings](https://github.com/DevXord/docvane/blob/main/docs/errors.md)

XLSX templates and the low-level OOXML code come from [xlvane](https://github.com/DevXord/xlvane), the sister project for working with spreadsheet files in code.

## License

[MIT](LICENSE)
