# Template syntax

tplvane templates are ordinary Word documents, PowerPoint presentations and Excel workbooks with tags in curly braces. This version reads Word documents (`.docx`, `.docm`, `.dotx`, `.dotm`), PowerPoint presentations (`.pptx`) and Excel workbooks (`.xlsx`).

```
Dear {customer.name},

{#items}
- {name}: {price | currency("PLN")}
{/items}
{^items}You have not ordered anything yet.{/items}

{#isVip}Thank you for being a VIP customer.{/isVip}

{%logo}
{~summary}
```

## Tags

| Tag | Name | Meaning |
|---|---|---|
| `{customer.name}` | value | The value at this path of the data |
| `{total \| currency("PLN")}` | value with formatters | The value passed through formatters, left to right |
| `{#items}…{/items}` | section | Repeats the content for each item of a list, or shows it once when the value is true |
| `{^items}…{/items}` | inverted section | Shows the content when the value is missing, false or an empty list |
| `{%logo}` | image | An image |
| `{~summary}` | Markdown | Markdown text, turned into formatted paragraphs |
| `{.}` | current item | Inside a section: the current item itself, for lists of plain values |

`render` fills values, sections, expressions, formatters, images, links and Markdown.

The basic tags (value, section, inverted section) follow the most common syntax of existing template engines, so that existing templates keep working.

## Tags in text

- A tag starts with `{` and ends with the next `}`.
- **A tag may be split into any number of pieces of formatting.** Word and LibreOffice store a paragraph as many runs of text: a change of font, a spelling mark, a bookmark, a comment or an edit in the middle of a tag splits it. tplvane joins the text of a paragraph before it looks for tags, so `{customer.name}` with `customer` in bold is still one tag.
- A tag must start and end in the same paragraph. A tab, a line break or an inline object (an image, a symbol, a footnote mark) cannot be inside a tag.
- Braces are reserved for tags: every `{` must have its `}`, and a `}` without a `{` is an error.
- Deleted text of tracked changes and the codes of fields are not template text; inserted text of tracked changes is.

Tags are read in the main text, in tables (at any depth), in text boxes, in headers, in footers, in footnotes and in endnotes.

## Delimiters

Tags start with `{` and end with `}` unless the option `delimiters` sets others, for example `{ start: '{{', end: '}}' }` or `{ start: '[[', end: ']]' }` (`--delimiters "{{ }}"` on the command line). The two delimiters must be different, without spaces, at most 10 characters, and neither may contain the other. A tag between equals signs changes the delimiters for the rest of its part (the body, a header, a footer, the notes, a slide, a sheet): `{=[[ ]]=}` makes `[[name]]` a tag; the tag itself shows nothing. `{/}` closes the innermost open section. These follow the basic syntax of docxtemplater; see [the migration guide](migrating-from-docxtemplater.md).

## Grammar

Inside the braces, in EBNF (ISO/IEC 14977 style, with `|` for alternatives, `[ ]` for optional and `{ }` for repetition):

```ebnf
tag        = ws , [ sigil , ws ] , body , ws ;
sigil      = "#" | "^" | "/" | "%" | "~" ;
body       = pipe              (* no sigil, "#" and "^" *)
           | path              (* "%" and "~" *)
           | logical ;         (* "/": no formatters *)
pipe       = logical , { ws , "|" , ws , formatter } ;
logical    = and , { ws , "||" , ws , and } ;
and        = compare , { ws , "&&" , ws , compare } ;
compare    = unary , [ ws , operator , ws , unary ] ;
operator   = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
unary      = "!" , ws , unary | operand ;
operand    = literal | path | "(" , ws , pipe , ws , ")" ;
formatter  = name , [ ws , "(" , ws , [ literal , { ws , "," , ws , literal } , ws ] , ")" ] ;
path       = "." | names ;
names      = name , { ws , "." , ws , name } ;
name       = name start , { name part } ;
literal    = string | number | "true" | "false" | "null" ;
string     = double quote , { character | "\" , any character } , double quote
           | single quote , { character | "\" , any character } , single quote ;
number     = [ "-" ] , ( "0" | digit 1-9 , { digit } ) , [ "." , digit , { digit } ] , [ ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit } ] ;
ws         = { " " | U+00A0 } ;
```

- **Names** start with a Unicode letter or `_` and go on with letters, digits, `_` and combining marks (the Unicode `ID_Start` and `ID_Continue` properties), so `{klient.imię}` and `{顧客.名前}` are valid. A name cannot contain `-` or spaces.
- **`__proto__`, `constructor` and `prototype`** are refused as names and as formatters, in every template, because they reach the internals of JavaScript objects.
- **Strings** are written in straight quotes `"…"` or `'…'`, or in the typographic quotes that word processors put in their place: `„…”`, `“…”`, `”…”`, `„…“` (double) and `‘…’`, `’…’`, `‚…’`, `‚…‘` (single). A string ends at the next quote of the same kind (double or single), so `"it's"` is valid. `\` makes the next character part of the string. Strings cannot contain `{` or `}`.
- **Spaces** (and no-break spaces, which Word sometimes inserts) are allowed around every part: `{ total | currency ( "PLN" ) }`.
- A **closing tag** names the section with the same expression: `{/items}` closes `{#items}` or `{^items}`, and `{/total > 100}` closes `{#total > 100}`. Spaces and the kind of quotes do not matter (`{#a>1}` is closed by `{/a > 1}`). Formatters on the opening tag are not repeated on the closing tag. Image and Markdown tags take a path only.

## Expressions

| Operator | Meaning |
|---|---|
| `a == b`, `a != b` | Equal, not equal: the same type and value, without conversion (`1 == "1"` is false) |
| `a < b`, `a <= b`, `a > b`, `a >= b` | Order of two numbers, or of two texts; other pairs are an error |
| `a && b` | `a` if it is false, otherwise `b` |
| `a \|\| b` | `a` if it is true, otherwise `b`: `{nickname \|\| name}` |
| `!a` | `true` when `a` is false |
| `( … )` | Grouping; formatters inside parentheses apply to that part only: `{(status \| upper) == "PAID"}` |

`!` binds tightest, then comparisons, then `&&`, then `||`, then `|` (formatters), as in JavaScript: `!a == b` compares `!a` with `b`. Comparisons cannot be chained (`a < b < c`); join them with `&&`.

False values are `false`, `null`, a missing value, `0`, `""` and an empty list; everything else is true.

There are no function calls, no arithmetic, no indexing (`a[0]`) and no assignment, and nothing in a template can run code. The length of a list or a text is read as a field: `{items.length}`, `{#items.length > 3}`. Expressions are limited in depth (`maxExpressionDepth`), and one tag holds at most 256 `&&` and `||`.

## Formatters

Formatters change a value before it is written: `{total | currency("PLN")}`. They apply from left to right. Only these exist; any other name is an error when the template is read.

| Formatter | Takes | Gives |
|---|---|---|
| `upper`, `lower` | text, number, boolean | Upper or lower case, by the rules of the locale |
| `capitalize` | text, number, boolean | The first letter in upper case |
| `trim` | text, number, boolean | Without spaces at the start and end |
| `default(x)` | anything | `x` when the value is missing, `null` or `""`; a missing value with a default is not an error |
| `number`, `number(d)` | number | The number in the locale, with `d` decimals (0 to 20); without `d`, at most 3 decimals, as the locale rounds them |
| `percent`, `percent(d)` | number | `0.25` as `25%` |
| `currency("PLN")`, `currency("EUR", d)` | number | The amount with the currency (a three-letter ISO 4217 code) |
| `date`, `date("short" \| "medium" \| "long" \| "full")` | `Date` or ISO 8601 text | The date in a style of the locale; `medium` without an argument |
| `date("dd.MM.yyyy HH:mm")` | `Date` or ISO 8601 text | The date by a pattern |
| `link`, `link("text")` | an `http`, `https` or `mailto` address | A hyperlink showing the address, or the text (see "Links") |

Date patterns use `yyyy` (year), `yy` (two digits), `MMMM` (month name), `MMM` (short month name), `MM` and `M` (month number), `dd` and `d` (day), `HH` and `H` (hour, 0 to 23), `mm` (minutes) and `ss` (seconds). Text in single quotes is written as it is (`'at'`, and `''` for a quote); other letters are an error, other characters are written as they are. Month names are written as they stand next to a day ("6 listopada" in Polish).

Numbers, currencies and dates use the `locale` option of `render` (default `en-US`). `Date` values and texts with a time zone (`2026-11-06T14:30:00Z`, `…+01:00`) are shown in the `timeZone` option (default `UTC`); dates and times without one (`2026-11-06`, `2026-11-06T14:30`) are shown as written. Numbers must be numbers in the data: the text `"12"` is not formatted as a number. Zero is written without a minus sign, also when a small negative number rounds to it. Dates are accepted from the year 0001 to 9999, and an offset has at most 23 hours and 59 minutes.

## Sections and scope

- Sections nest: `{#orders}…{#lines}…{/lines}…{/orders}`. Each section must be closed in the same part of the document where it opens: the main text, one header, one footer, or the notes. Sections may span paragraphs, table cells and table rows.
- Inside a section, names refer to the current item first. In `{#lines}{product}{/lines}`, `product` is a field of each line.
- `{.}` is the current item itself: `{#tags}{.}, {/tags}` lists plain values.

## Rendering

`render(template, data, options)` returns the filled document.

- **Values** are written with the formatting of the first character of the tag (`{` in bold gives a bold value), and the text around the tag keeps its own formatting. Texts are written as they are, numbers and booleans as text, `null` as nothing. A line break in a value becomes a line break in the document, a tab a tab. Every value is escaped, so data cannot change the structure of the document. Objects, lists and `Date` values need a field, a section or a formatter.
- **Data** is read through own properties only: a getter is never called, and nothing is read from prototypes.
- **Sections** repeat or show content by their value: a list repeats the content once per item (nothing for an empty list); an object shows it once, with the object as the current item; another true value shows it once; a false value shows nothing. `{^name}` shows its content when the value is false or an empty list.
- **What a section repeats** follows from where its tags are:

| Tags | Repeated |
|---|---|
| Both in one paragraph | The part of the paragraph between them |
| In different paragraphs, each tag alone in its paragraph | The paragraphs and tables between them; the paragraphs of the two tags are removed. A list is a series of paragraphs, so this repeats list items. |
| In different cells of one table row | The row |
| In different rows of one table | The rows from the one of the opening tag to the one of the closing tag |

  Other placements give `TV_E_SECTION_PLACEMENT`, with a message that names the problem: a section that starts inside a table and ends after it, one tag inside a content control and the other outside, tags that share their paragraph with other text when the section spans paragraphs, or repeated rows of a slide table with cells merged down (in documents, merged cells are copied with their rows).
- **Copies** of repeated content leave out bookmarks and comment ranges, which must be unique, after the first copy, and drawings get new ids. A footnote or endnote in content that repeats gives `TV_E_NOT_SUPPORTED`, because a note belongs to one place; so does a chart or a SmartArt diagram in content that repeats more than once, because each one needs a part of its own. Shown once, they stay.
- **Removed content.** A table cell, header, footer, note or text box that a section shown no time leaves without a paragraph gets an empty one, which Word requires. Comments whose marks were all in removed content are left out of the comments of the document.
- **The end of a document.** When the body of a Word document ends with a table, for example after `{/items}` that closed a loop around a final table is removed, an empty paragraph is added after the table, before the section properties: the standard places the last section properties after the final paragraph (ECMA-376 Part 1, Annex L.1.7.1). LibreOffice 26.2 does not finish exporting a document that ends with a table as text.
- **Text boxes** are searched for tags in both forms Word writes: DrawingML with a VML fallback, and VML alone (Word 2007, compatibility mode).
- **Missing data.** A value tag, a loop or an operand of a comparison without data gives `TV_E_MISSING_FIELD`; every such problem is listed in one `TV_E_DATA_INVALID`. A missing condition counts as false. With `{ missing: 'empty' }` a missing value shows nothing.
- **Limits.** `maxIterations` limits how often all sections together repeat their content, and `maxOutputBytes` the size of the rewritten parts.

## Images

`{%logo}` inserts a picture in place of the tag, in line with the text and with the formatting of the tag. The value is one of:

- the bytes of a PNG, JPEG or GIF file (a `Uint8Array`, which a Node.js `Buffer` is, or an `ArrayBuffer`);
- a data URL: `data:image/png;base64,…` (also `image/jpeg` and `image/gif`);
- an `http` or `https` address, only with `renderAsync` and a `fetchImage` function (below);
- an object `{ data, width, height, alt }`: `data` is one of the above, `width` and `height` are centimetres, `alt` is the alternative text.

The size comes from the file (its pixels at the resolution it gives, or 96 per inch) and is reduced, keeping the proportions, to fit the width of the table cell or of the text column. `width` or `height` set the size; with only one of them, the other follows the proportions. The same image used many times is stored once. `null` shows nothing.

**Addresses are never fetched by tplvane.** `render` reports an address as an invalid value. `renderAsync(template, data, { fetchImage })` calls `fetchImage(url)`, a function you write and control, once per distinct address, and inserts the bytes it returns; your function decides which addresses are allowed. This keeps data from making a server connect to internal addresses. Problems of the data are reported before any image is fetched; each image fetched must be within `maxImageBytes`, and all of them together within `maxInputBytes`.


With `renderAsync`, every http(s) address in the data reaches your `fetchImage` function, including addresses of internal hosts and addresses with user names. Data is untrusted: let the function fetch only from hosts you allow, as in the example of `renderAsync`, so that data cannot make your server request internal addresses. The same image repeated in a loop is added to the document once.
## Links

`{site | link}` writes a hyperlink to the address in `site`, showing the address; `{site | link("Our website")}` shows the text instead. Only absolute `http`, `https` and `mailto` addresses are accepted, without spaces, quotes, angle brackets, backslashes, control characters, characters that a document cannot hold (U+FFFE, U+FFFF, a lone surrogate) and characters that reorder or hide text (bidirectional controls, zero-width marks); anything else (`javascript:`, `file:`, `data:`, relative addresses) is an invalid value. The link uses the character style "Hyperlink" of the template, on top of the formatting of the tag; a template without it gets no colour or underline from tplvane, and a `TV_W_STYLE_MISSING` warning.

## Markdown

`{~summary}` writes Markdown, such as the output of an AI model, with the styles of the template:

| Markdown | In the document |
|---|---|
| Paragraphs (separated by a blank line) | Paragraphs with the properties of the tag's paragraph |
| `# Heading` … `###### Heading` | Paragraphs in the template's styles "heading 1" … "heading 6" |
| `- item`, `* item`, `+ item`, nested by two spaces (up to three levels) | Paragraphs in "List Bullet", "List Bullet 2", "List Bullet 3" |
| `1. item`, `1) item` | Paragraphs in "List Number", "List Number 2", "List Number 3" |
| `**bold**`, `*italic*`, `_italic_` | Bold and italic on top of the formatting of the tag |
| `` `code` ``, ``` ``co`de`` ``` | The character style "HTML Code" |
| `[text](https://…)` | A link, as above; parentheses inside the address are kept when they are balanced (`https://en.wikipedia.org/wiki/A_(B)`). A link whose address cannot be a link (relative, `javascript:`, empty) shows its text without a link. |
| Two spaces or `\` at the end of a line | A line break |
| `\*` and other backslash escapes | The character itself |

Styles are found by their name, without regard to letter case, and tplvane never adds styles of its own: without a heading style a heading keeps the style of the tag's paragraph; without a list style an item gets "• " or "1. " as text; each missing style gives a `TV_W_STYLE_MISSING` warning (`onWarning` option). HTML, images (`![alt](x.png)`) and tables in Markdown are written as text. Everything is escaped. When the "List Number" style has numbering, each numbered list starts again at its own first number (`5.` starts at 5). LibreOffice does not save the numbering of its list styles in DOCX: in a template saved by LibreOffice, list items have the style but no bullet or number.

When `{~summary}` is alone in its paragraph, that paragraph is replaced by the paragraphs of the Markdown. When it shares the paragraph with other text, only inline Markdown (bold, italic, code, links, line breaks) is allowed, and headings, lists or several paragraphs are an invalid value.

## PowerPoint

The same tags work in presentations: in text boxes and other shapes, in table cells and in the notes of a slide. Tags are found however PowerPoint or LibreOffice split the text into runs. The slide masters and layouts are not read.

- **Values** keep the run properties of the tag's first character; a line break in a value becomes a line break in the shape.
- **Sections inside a slide** repeat within a paragraph, over paragraphs of one shape (each tag alone in its paragraph), over a table row or a range of rows, as in Word documents.
- **Repeating slides.** A section whose opening tag and closing tag each fill a shape of their own repeats slides: from the slide with `{#products}` to the slide with `{/products}`, which can be the same slide. Each copy gets its own notes, rendered with the same item. The two shapes with the tags are left out of the result, and slides of an empty list are removed with their notes, comments and charts. Such sections can be nested, but only in other sections that repeat slides; two at the same level may not share a slide. A slide with a chart, SmartArt, comments or an embedded object cannot be repeated (`TV_E_NOT_SUPPORTED`): the copies would share those parts.
- **Images.** `{%photo}` must be the whole text of a shape that has its own position and size: the picture takes its place, fitted into the shape with its proportions kept and centred. A shape that takes its position from its layout is a problem of the template (`TV_E_TAG_PLACEMENT`). The values are the same as in Word documents.
- **Links.** `{site | link("text")}` writes a hyperlink; PowerPoint shows it in the theme's link colour.
- **Markdown.** `{~summary}` alone in a paragraph becomes paragraphs: list items get the indentation levels 0 to 2 of the shape, so the bullets come from the shape's own list styles; headings are bold paragraphs; bold, italic and links as in Word documents.
- **Places** name the slide and the shape: `slide 3, shape "Title 1", paragraph 1`, or `slide 3 notes, …`.

## Excel

The same tags work in the text cells of every sheet. tplvane reads and edits workbooks only through the public API of [xlvane](https://github.com/DevXord/xlvane). Formulas are not searched for tags: braces in a formula are array constants.

- **Values with their type.** A cell that holds a single value tag and nothing else (spaces aside) gets the type of the value: a number stays a number, `true` and `false` become a boolean, a `Date` becomes a date and time as it is in the `timeZone` option (with the cell's date format, or `yyyy-mm-dd` when the cell has none and the time is midnight, `yyyy-mm-dd hh:mm:ss` otherwise; years 1900 to 9999), `null` leaves the cell empty. Every other cell gets text: one with several tags, other text, or formatters (`{price | currency("PLN")}` is text). Text that starts with `=` stays text; a value never becomes a formula. A cell holds at most 32 767 characters. The format of the cell is kept; a tag in rich text gives plain text.
- **A section within one cell** repeats or shows part of the cell's text: `{#tags}{.}, {/tags}`.
- **Repeating rows.** A section whose opening and closing tags are in different cells repeats the rows from the row of `{#items}` to the row of `{/items}`, with every cell of those rows:

  | | A | B | C | D |
  |---|---|---|---|---|
  | 1 | Product | Price | Double | |
  | 2 | `{#items}{name}` | `{price}` | `=B2*2` | `{/items}` |
  | 3 | Total | `=SUM(B2:B2)` | | |

  For each item, the rows are copied below the template rows: tags take the values of the item, constants are copied, and formulas move with their row (`=B3*2` in the second copy), as when a formula is copied in Excel. A single repeated row also brings its height and the formats of all its cells; a block of several rows brings the formats of the cells that have values. When the opening and the closing tag are each alone in a row of their own, those two rows only mark the section: the rows between them repeat, and the two rows are deleted. A one-column list is written that way, because a section within one cell repeats text, not rows.
- **Totals follow the copies.** Rows below the copies move down, and every reference moves with them, on all sheets. In addition, tplvane extends every range whose last row is the last template row to the last copy, in formulas on every sheet: `=SUM(B2:B2)` above becomes `=SUM(B2:B4)` for three items, and so does `=SUM(Data!B2:B2)` on another sheet. Ranges that end elsewhere change as in Excel. Single cells, whole rows and columns, 3-D references (`Jan:Mar!B2:B5`), references to other workbooks, names and structured references (`Table1[Price]`) are not extended. A formula outside the copies that refers to a single cell of the repeated rows, such as `=SUM(B2)`, keeps using the first copy; `inspect`, `validate` and `render` warn about it with `TV_W_FORMULA_NOT_EXTENDED`. Google Sheets writes `=SUM(B2:B2)` as `=SUM(B2)`, so there start the range at the header row: `=SUM(B1:B2)`.
- **An empty list** deletes the rows of the section. A range that lay entirely in them becomes `#REF!`, as in Excel when rows are deleted; to keep a total valid for empty lists, start its range at the header row: `=SUM(B1:B2)` adds up nothing when the list is empty and all the items otherwise.
- **Recalculation.** The results of formulas stored in the template are out of date after rendering, so tplvane removes them: Excel, LibreOffice and other applications compute every formula when they open the file. Array formulas keep their stored result.
- **Templates saved by LibreOffice.** LibreOffice writes a `dateCompatibility` attribute into the workbook properties. No version of the Office Open XML standard defines it, and Excel 2007 reports a workbook that has it as damaged, so tplvane leaves it out of the result. The date system of the workbook (1900 or 1904) is not changed.
- **Text of the template.** The shared strings of the result hold only the texts its cells use: tags and the text of sections shown no time do not stay in the file.
- **One level.** A section that repeats rows cannot be inside another one, two such sections cannot share a row, and every tag in the rows of a section must be inside it (`TV_E_SECTION_PLACEMENT`). Sections within one cell can be anywhere.
- **Not copied to the new rows:** merged cells, conditional formatting, data validation, hyperlinks and notes of the template rows. Below the copies they move with their rows. Defined names are not extended over the copies. A table (`Table1`) whose last row is the last template row, and its filter, are extended to the last copy, like ranges in formulas.
- **Not supported in workbooks yet:** images (`{%logo}`), Markdown (`{~notes}`) and the `link` formatter give `TV_E_NOT_SUPPORTED`; so does a sheet where xlvane cannot insert rows (one with a chart, for example), an array formula or data table in repeated rows, and an array formula elsewhere whose range the copies would extend (write it as an ordinary formula, such as `SUMPRODUCT`). Many sections in one workbook each read and write the whole workbook; their work counts against `maxOutputBytes`.
- **Delimiters.** After `{=[[ ]]=}` in a cell, every text cell of the workbook is read, so that tags in the new delimiters are found.
- **Places** name the sheet and the cell: `sheet Data, cell C5`, with `sheet` and `cell` in the location.

## Validating data

`validate(template, data, options)` checks data against a template without writing a file and returns `{ valid, errors, warnings, schema }` instead of throwing:

```ts
import { readFileSync } from 'node:fs';
import { validate } from 'tplvane';

const result = validate(readFileSync('offer.docx'), { customer: {}, items: [{ nme: 'Desk' }] });
// result.valid === false; among result.errors (in the order of the template):
// details.dataPath === 'customer.name'
// details.dataPath === 'items[0].name', details.available === ['nme'], hint: 'Did you mean "nme"? … The data has here: nme.'
```

- **`errors`** are exactly the problems `render` would report for this data with the same options (`limits`, `locale`, `timeZone`, `missing`): `validate` renders without writing. Each error has the place of its tag in the template, and in `details` the path of the field in the data, as `dataPath` (`items[1].name`) and `pointer` (`/items/1/name`, a JSON Pointer). For a missing field, `available` and the hint list the fields of the object where it is missing.
- **`warnings`** add `TV_W_DATA_SCHEMA` where the data does not fit the JSON Schema of `inspect` although `render` accepts it: a field used only in a section this data does not show, a condition that is not a boolean, `null` for a value. `details.pointer` names the field.
- **Images** given as addresses are not fetched and count as valid; `renderAsync` fetches them.
- Problems of the template and the file are thrown, as by `inspect`.

`templateSchema(template, options)` gives the same check as a [Standard Schema](https://standardschema.dev), for libraries that accept one: `schema['~standard'].validate(data)` returns `{ value }` or `{ issues }`, each issue with the message, the hint and the `path` of the field. `schema.jsonSchema` is the schema of `inspect`.

## Making a template from a finished document

`makeTemplate(document, replacements, options)` turns texts of a finished document, presentation or workbook into tags, so that a template can be made from a real example:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { makeTemplate } from 'tplvane';

const result = makeTemplate(readFileSync('offer-for-jan.docx'), [
  { find: 'Jan Kowalski', tag: 'customer.name' },
  { find: 'Laptop', with: '{#items}{name}' },
  { find: '4 500,00 zł', with: '{price | currency("PLN")}{/items}' },
  { find: 'ACME', tag: 'company', where: 'footer' },
]);
writeFileSync('offer.docx', result.document);
// result.replacements: for each entry, the number of matches and their places; result.schema: as inspect returns it
```

- **An entry** has `find`, a text exactly as `preview` shows it, with letter case, and either `tag` (the content of one tag, written with the delimiters of the `delimiters` option) or `with` (template text, written as it is). `where` limits it to the parts whose name, as `preview` shows it, is that name or starts with it and a space: `body`, `header`, `footer`, `footnotes`, `slide 2`, `slide 2 notes`, `sheet Data`. `occurrence` keeps only that match, counted from 1 in reading order.
- **Matches** are plain text, without regular expressions, within one paragraph or one text cell, however the text is split into runs. A space and a no-break space (U+00A0, U+202F, U+2007), which `preview` shows alike and number and currency formats write, match each other; everything else is matched exactly. They do not cross paragraphs, tabs, line breaks or objects. Numbers, dates and formulas of a workbook are not read. Every match is found in the original before anything is replaced, so the order of the entries does not matter and what one entry writes is not searched by another.
- **Formatting:** a tag takes the formatting of the first run of its match, as tags do when they are rendered (`{` in bold gives a bold value). In a cell with rich text, the other runs are kept. In a text box, the other form of the box that Word keeps for older versions is left out, as `render` does.
- **Problems** are thrown and nothing is returned: `TV_E_TEXT_NOT_FOUND` lists every entry without a match, `TV_E_REPLACEMENT_OVERLAP` names two matches that overlap or a match that overlaps a tag of the document, `TV_E_TEMPLATE_INVALID` lists the problems of the result (for example `{#items}` without `{/items}`), and wrong entries give `TV_E_INVALID_OPTION` or the error of the tag.
- **Not done:** fields are not detected automatically, extra sample rows of a table are not removed, and images do not become image tags.

The command line does the same with `tplvane make-template <document> <map.json>`, where the map is a JSON list of entries, and the MCP server of `@tplvane/mcp` with the tool `make_template`.

## The data schema

`inspect` returns a JSON Schema (draft 2020-12) of the data the template needs. The syntax of a loop and a condition is the same, so `inspect` reads a section from what is inside it:

| In the template | In the schema |
|---|---|
| `{a.b.c}` | `a` and `b` are objects; `c` is a string, a number or a boolean. All three are required. |
| `{nickname \| default("-")}` | `nickname` is an optional value |
| `{#total > 100}…{/total > 100}` | `total` is a required value; the content is in the same scope |
| `{#a && !b}…{/a && !b}`, `{a \|\| b}` | `a` and `b` are optional booleans (tested for truth) |
| `{#items}…{name}…{/items}` (tags inside) | `items` is a required array of objects with a required `name` |
| `{#tags}{.}{/tags}` | `tags` is a required array of strings, numbers or booleans |
| `{#isVip}…{/isVip}` (no tags inside) | `isVip` is an optional boolean |
| `{^items}…{/items}` alone | `items` is an optional boolean |
| `{%logo}` | `logo` is required: a data URL or an address (a string), or `{ data, width, height, alt }` |
| `{site \| link}` | `site` is a required string, a link address |
| `{~summary}` | `summary` is a required string |

- A name used both as a condition and in another way takes the other kind: `{#name}Dear {/name}{name}` gives a required value, and `{^items}…{/items}` next to `{#items}{x}{/items}` gives a required array.
- Two loops over the same list are merged: their fields are the fields of one item.
- A section with tags inside is always read as a loop, also when it is meant as a condition: `{#isVip}{discount}{/isVip}` gives `isVip` as an array of objects with `discount`.
- A name used in ways that do not fit together (a value and a loop, say) gives `anyOf` with each kind and a `TV_W_SCHEMA_CONFLICT` warning.
- Every property has a `description` that says what it is and where it is first used, for example `Loop in body, table 1 row 2 cell 1, paragraph 1.`
- Objects allow fields that the template does not use.

## Places in the document

Every tag, section and problem has a `location`: the part, the story (`body`, `header`, `footer`, `footnote`, `endnote`, `slide`, `notes`, `sheet`), the slide or the sheet and cell, the table cells and text boxes around it, the paragraph and the character, all counted from 1, and a `description` such as `body, table 2 row 3 cell 1, paragraph 1`. Tables, text boxes and paragraphs are counted inside their container: the story, a table cell or a text box. Notes are counted in the order of their part.

## Limits

Templates and data are treated as untrusted. Besides the limits on the ZIP and XML structure, the length of a tag (`maxTagLength`, 1 024 characters), the number of tags (`maxTags`, 100 000), the nesting of sections (`maxSectionDepth`, 32) and of expressions (`maxExpressionDepth`, 32), the number of problems collected (`maxErrors`, 100), the repetitions of sections in one render (`maxIterations`, 100 000), the size of the result (`maxOutputBytes`, 256 Mi characters of XML and bytes of images; in workbooks, characters of text), images (`maxImageBytes`, 20 MiB each; `maxImagePixels`, 100 million pixels each; `maxImages`, 1 000 different ones) and Markdown (`maxMarkdownLength`, 1 Mi characters) are limited. `maxXmlTreeElements` (1 million) limits the elements of every XML part that tplvane reads, the template's text included. Output is counted while it is built, also the paragraphs of Markdown and the copies of repeated rows and slides, so a small template cannot build a large result before the limit stops it. The text of `preview` is limited by `maxOutputBytes` too. In workbooks, xlvane also limits the number of cells (`maxCells`, its default). See docs/errors.md for the errors.
