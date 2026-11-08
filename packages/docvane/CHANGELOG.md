# Changelog

All notable changes to `docvane` are listed here. The version numbers follow semantic versioning.

## 1.0.0 - 2026-11-08

The first release.

### Templates
- One tag syntax for Word (`.docx`, `.docm`, `.dotx`, `.dotm`), PowerPoint (`.pptx`) and Excel (`.xlsx`) templates: values `{customer.name}`, sections `{#items}…{/items}` that repeat for lists and show for true values, inverted sections `{^items}…{/items}`, the current item `{.}`, images `{%logo}` and Markdown `{~summary}`.
- Expressions without any code from the template: `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!` and parentheses.
- Formatters: `upper`, `lower`, `capitalize`, `trim`, `default`, `number`, `percent`, `currency`, `date` and `link`.
- Tags are found however Word, PowerPoint, Excel or LibreOffice split their text, in the body, tables, text boxes, headers, footers, footnotes and endnotes, slides and their notes, and the cells of every sheet.
- **What a section repeats follows from where its tags are:** part of a paragraph, whole paragraphs, table rows, slides, or rows of a sheet.
- **In Excel:** cells that hold one value keep its type; the formulas of repeated rows move with them, and totals below the copies, tables and their filters grow to cover them.
- **Images:** from bytes or data URLs, fitted to the cell, the text column or the shape. Images from http(s) addresses are fetched only through `renderAsync` with a `fetchImage` function you pass.
- **Markdown:** headings, lists, bold, italic, code and links, in the template's own styles; each numbered list starts at its own first number.
- **Removed content** takes its comments with it, so a section shown no time leaves no hidden text in the comments of a Word document.
- **Strict Open XML** documents and presentations are read and stay Strict: what a render adds uses the Strict names.
- **docxtemplater syntax:** the basic tags are read, other delimiters are set with the `delimiters` option or `{=[[ ]]=}`, and `{/}` closes the innermost section. See the migration guide.

### API
- `inspect(template)`: the tags with their places, the sections, and the JSON Schema of the data.
- `render(template, data, options)` and `renderAsync(...)`: the result as bytes.
- `validate(template, data)`: every problem `render` would report, with the path of the field in the data, the place in the template and the fields that are there; it never throws for data.
- `templateSchema(template)`: the same check as a Standard Schema.
- `preview(document)`: the text of a document, presentation or workbook, to check a result without an office application.
- Errors have a stable `DV_E_*` code, a place in the template and a hint; problems of a template or of data are reported all at once.

### Command line
- `docvane inspect`, `render`, `validate` and `preview`.
- Errors in three parts with a command to try.
- `--json` with documented schemas; colour only on a terminal.
- `render` never replaces a file without `--force`, and `--dry-run` checks without writing.
- Image files must be next to the data file, and nothing is downloaded without `--fetch-images`.

### Security
- Templates and data are treated as untrusted:
  - limits on the ZIP and XML structure (no DTDs or entities);
  - limits on tags, nesting, repetitions and the size of the result, counted before rows, slides or repetitions are built;
  - every value is escaped, and raw XML cannot be inserted;
  - no network access unless you pass a function or `--fetch-images`.
- The result holds no text of the template that was not shown: parts used only by removed slides (images, comments, charts) are left out, and the shared strings of a workbook keep only the texts its cells use. Only the parts of the package are written, so ZIP items with names such as `../x` do not reach the result.
- Two runtime dependencies: `xlvane` and `fflate`.
