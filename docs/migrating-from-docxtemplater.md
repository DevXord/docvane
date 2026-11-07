# Migrating from docxtemplater

docvane reads the basic tags of docxtemplater: values, loops, inverted sections, conditions, `{.}`, `{/}` and changes of delimiters. Most templates that use only these tags work without changes. This guide lists what works as it is, what needs a change, and what docvane does not have. It is based on the public documentation of the open-source core of docxtemplater; the syntax of its paid modules is named only to say what to use instead.

## Code

```js
// docxtemplater: a zip object in, rendered in place
const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
doc.render(data);

// docvane: the bytes of the template in, the bytes of the result out
import { render } from 'docvane';
const result = render(templateBytes, data);
```

docvane needs no ZIP library: it takes the file as a `Uint8Array` (a Node.js `Buffer` is one) and returns a new one. `inspect(templateBytes)` lists the tags and returns a JSON Schema of the data; `validate(templateBytes, data)` checks data without rendering.

## Works without changes

| docxtemplater | docvane |
|---|---|
| `{name}`, `{user.name}` | The same. Only own data properties are read; names such as `__proto__` and `constructor` are refused. |
| `{#users}…{/users}` | The same: a loop over a list, shown once for a true value. What it repeats follows from where its tags are: part of a paragraph, whole paragraphs, table rows. |
| `{^users}…{/users}` | The same: shown when the value is missing, false or an empty list. |
| `{.}` | The same: the current item of a list of plain values. |
| `{/}` | The same: closes the innermost open section. |
| `{=[[ ]]=}` | The same: changes the delimiters for the rest of the part (the body, a header, a slide, a sheet). |
| Option `delimiters: { start: '[[', end: ']]' }` | The same option, in `inspect`, `render`, `validate` and `--delimiters "[[ ]]"` on the command line. |
| PowerPoint templates (`.pptx`) | The same tags; also in notes, and a section whose tags each fill a shape of their own repeats slides. |

## Needs a change

| docxtemplater | docvane |
|---|---|
| `paragraphLoop: true` | No option needed: a section whose opening and closing tags are each alone in a paragraph repeats the paragraphs between them, and the two paragraphs with the tags are left out. |
| `linebreaks: true` | No option needed: a line break in a value always becomes a line break in the document. |
| Expressions with a custom parser, such as `{#users.length > 3}` | docvane has its own expression language, without any code from the template: `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `\|\|`, `!` and parentheses, on names, numbers, texts, `true`, `false` and `null`. Arithmetic, function calls and assignments are not available: compute such values in the data. |
| Filters of a custom parser, such as `{price \| currency}` | A fixed list of formatters: `upper`, `lower`, `capitalize`, `trim`, `default`, `number`, `percent`, `currency`, `date` and `link`, with literal arguments such as `{price \| currency("EUR")}`. |
| `nullGetter` | Option `missing`: `'error'` (default) reports every missing value with its place and the path of the field; `'empty'` shows nothing. |
| An image tag `{%image}` of a paid module | `{%image}` is part of docvane: the value is the bytes of a PNG, JPEG or GIF, a data URL, or `{ data, width, height, alt }`. Addresses are fetched only through `renderAsync` with a `fetchImage` function you pass. |
| A tag `{~html}` of a paid module | `{~name}` in docvane is Markdown, not HTML: headings, lists, bold, italic, code and links, in the template's own styles. |
| Excel templates of a paid module | Excel templates are part of docvane: the same tags in cells, typed values, repeated rows with their formulas, and totals that follow the copies. |
| Repeating slides with `{:users}` of a paid module | `{#users}` and `{/users}`, each alone in a shape, repeat the slides from the one with the opening tag to the one with the closing tag. |

## Not available

| docxtemplater | Why, and what to do |
|---|---|
| `{@rawXml}` | Data cannot insert raw XML: docvane escapes every value, so that data cannot change the structure of a document. Use Markdown (`{~name}`) for formatted text. |
| `{-w:p loop}`, `{-w:tr loop}` | Loops over a named element are not available. Put the tags of `{#loop}` alone in their paragraphs, or in the cells of a table row. |
| Other tags of paid modules (`{:…}`, `{$chart}`, `{r@…}`, `{?…}`) | Not available. |
| `syntax` options (`allowUnopenedTag`, `allowUnclosedTag`, `allowUnbalancedLoops`, `changeDelimiterPrefix`) | docvane reports every unopened, unclosed or crossed tag with its place and a hint; it does not render a template with such problems. A tag between equals signs always changes the delimiters. |
| `parser`, `modules`, `errorLogging`, `warnFn` | Not available. Problems are thrown as a `DvError` with a code, a place in the template and a hint, all of them at once; warnings go to the `onWarning` option. |

## Errors

docxtemplater and docvane both report template errors, but the format differs. docvane throws `DV_E_TEMPLATE_INVALID` for the template and `DV_E_DATA_INVALID` for the data, each listing every problem in `errors` with a code, a place (`body, table 1 row 2 cell 1, paragraph 1`) and a hint; see [the error catalogue](errors.md).
