# Template syntax

docvane templates are ordinary Word documents with tags in curly braces. The same syntax is planned for PowerPoint and Excel templates; this version reads Word documents (`.docx`, `.docm`, `.dotx`, `.dotm`).

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
- **A tag may be split into any number of pieces of formatting.** Word and LibreOffice store a paragraph as many runs of text: a change of font, a spelling mark, a bookmark, a comment or an edit in the middle of a tag splits it. docvane joins the text of a paragraph before it looks for tags, so `{customer.name}` with `customer` in bold is still one tag.
- A tag must start and end in the same paragraph. A tab, a line break or an inline object (an image, a symbol, a footnote mark) cannot be inside a tag.
- Braces are reserved for tags: every `{` must have its `}`, and a `}` without a `{` is an error.
- Deleted text of tracked changes and the codes of fields are not template text; inserted text of tracked changes is.

Tags are read in the main text, in tables (at any depth), in text boxes, in headers, in footers, in footnotes and in endnotes.

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

There are no function calls, no arithmetic, no indexing (`a[0]`) and no assignment, and nothing in a template can run code. Expressions are limited in depth (`maxExpressionDepth`).

## Formatters

Formatters change a value before it is written: `{total | currency("PLN")}`. They apply from left to right. Only these exist; any other name is an error when the template is read.

| Formatter | Takes | Gives |
|---|---|---|
| `upper`, `lower` | text, number, boolean | Upper or lower case, by the rules of the locale |
| `capitalize` | text, number, boolean | The first letter in upper case |
| `trim` | text, number, boolean | Without spaces at the start and end |
| `default(x)` | anything | `x` when the value is missing, `null` or `""`; a missing value with a default is not an error |
| `number`, `number(d)` | number | The number in the locale, with `d` decimals (0 to 20) |
| `percent`, `percent(d)` | number | `0.25` as `25%` |
| `currency("PLN")`, `currency("EUR", d)` | number | The amount with the currency (a three-letter ISO 4217 code) |
| `date`, `date("short" \| "medium" \| "long" \| "full")` | `Date` or ISO 8601 text | The date in a style of the locale; `medium` without an argument |
| `date("dd.MM.yyyy HH:mm")` | `Date` or ISO 8601 text | The date by a pattern |
| `link`, `link("text")` | an `http`, `https` or `mailto` address | A hyperlink showing the address, or the text (see "Links") |

Date patterns use `yyyy` (year), `yy` (two digits), `MMMM` (month name), `MMM` (short month name), `MM` and `M` (month number), `dd` and `d` (day), `HH` and `H` (hour, 0 to 23), `mm` (minutes) and `ss` (seconds). Text in single quotes is written as it is (`'at'`, and `''` for a quote); other letters are an error, other characters are written as they are. Month names are written as they stand next to a day ("6 listopada" in Polish).

Numbers, currencies and dates use the `locale` option of `render` (default `en-US`). `Date` values and texts with a time zone (`2026-11-06T14:30:00Z`, `…+01:00`) are shown in the `timeZone` option (default `UTC`); dates and times without one (`2026-11-06`, `2026-11-06T14:30`) are shown as written. Numbers must be numbers in the data: the text `"12"` is not formatted as a number.

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

  Other placements, such as a section that starts inside a table and ends after it, or tags that share their paragraph with other text when the section spans paragraphs, give `DV_E_SECTION_PLACEMENT`.
- **Copies** of repeated content leave out bookmarks and comment ranges, which must be unique, after the first copy, and drawings get new ids.
- **Missing data.** A value tag, a loop or an operand of a comparison without data gives `DV_E_MISSING_FIELD`; every such problem is listed in one `DV_E_DATA_INVALID`. A missing condition counts as false. With `{ missing: 'empty' }` a missing value shows nothing.
- **Limits.** `maxIterations` limits how often all sections together repeat their content, and `maxOutputBytes` the size of the rewritten parts.

## Images

`{%logo}` inserts a picture in place of the tag, in line with the text and with the formatting of the tag. The value is one of:

- the bytes of a PNG, JPEG or GIF file (a `Uint8Array`, which a Node.js `Buffer` is, or an `ArrayBuffer`);
- a data URL: `data:image/png;base64,…` (also `image/jpeg` and `image/gif`);
- an `http` or `https` address, only with `renderAsync` and a `fetchImage` function (below);
- an object `{ data, width, height, alt }`: `data` is one of the above, `width` and `height` are centimetres, `alt` is the alternative text.

The size comes from the file (its pixels at the resolution it gives, or 96 per inch) and is reduced, keeping the proportions, to fit the width of the table cell or of the text column. `width` or `height` set the size; with only one of them, the other follows the proportions. The same image used many times is stored once. `null` shows nothing.

**Addresses are never fetched by docvane.** `render` reports an address as an invalid value. `renderAsync(template, data, { fetchImage })` calls `fetchImage(url)`, a function you write and control, once per distinct address, and inserts the bytes it returns; your function decides which addresses are allowed. This keeps data from making a server connect to internal addresses.

## Links

`{site | link}` writes a hyperlink to the address in `site`, showing the address; `{site | link("Our website")}` shows the text instead. Only absolute `http`, `https` and `mailto` addresses are accepted, without spaces, quotes, angle brackets, backslashes or control characters; anything else (`javascript:`, `file:`, `data:`, relative addresses) is an invalid value. The link uses the character style "Hyperlink" of the template, on top of the formatting of the tag; a template without it gets no colour or underline from docvane, and a `DV_W_STYLE_MISSING` warning.

## Markdown

`{~summary}` writes Markdown, such as the output of an AI model, with the styles of the template:

| Markdown | In the document |
|---|---|
| Paragraphs (separated by a blank line) | Paragraphs with the properties of the tag's paragraph |
| `# Heading` … `###### Heading` | Paragraphs in the template's styles "heading 1" … "heading 6" |
| `- item`, `* item`, `+ item`, nested by two spaces (up to three levels) | Paragraphs in "List Bullet", "List Bullet 2", "List Bullet 3" |
| `1. item`, `1) item` | Paragraphs in "List Number", "List Number 2", "List Number 3" |
| `**bold**`, `*italic*`, `_italic_` | Bold and italic on top of the formatting of the tag |
| `` `code` `` | The character style "HTML Code" |
| `[text](https://…)` | A link, as above |
| Two spaces or `\` at the end of a line | A line break |
| `\*` and other backslash escapes | The character itself |

Styles are found by their name, without regard to letter case, and docvane never adds styles of its own: without a heading style a heading keeps the style of the tag's paragraph; without a list style an item gets "• " or "1. " as text; each missing style gives a `DV_W_STYLE_MISSING` warning (`onWarning` option). HTML, images and tables in Markdown are written as text. Everything is escaped.

When `{~summary}` is alone in its paragraph, that paragraph is replaced by the paragraphs of the Markdown. When it shares the paragraph with other text, only inline Markdown (bold, italic, code, links, line breaks) is allowed, and headings, lists or several paragraphs are an invalid value.

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
- A name used in ways that do not fit together (a value and a loop, say) gives `anyOf` with each kind and a `DV_W_SCHEMA_CONFLICT` warning.
- Every property has a `description` that says what it is and where it is first used, for example `Loop in body, table 1 row 2 cell 1, paragraph 1.`
- Objects allow fields that the template does not use.

## Places in the document

Every tag, section and problem has a `location`: the part, the story (`body`, `header`, `footer`, `footnote`, `endnote`), the table cells and text boxes around it, the paragraph and the character, all counted from 1, and a `description` such as `body, table 2 row 3 cell 1, paragraph 1`. Tables, text boxes and paragraphs are counted inside their container: the story, a table cell or a text box. Notes are counted in the order of their part.

## Limits

Templates and data are treated as untrusted. Besides the limits on the ZIP and XML structure, the length of a tag (`maxTagLength`, 1 024 characters), the number of tags (`maxTags`, 100 000), the nesting of sections (`maxSectionDepth`, 32) and of expressions (`maxExpressionDepth`, 32), the number of problems collected (`maxErrors`, 100), the repetitions of sections in one render (`maxIterations`, 100 000), the size of the result (`maxOutputBytes`, 256 Mi characters of XML and bytes of images), images (`maxImageBytes`, 20 MiB each; `maxImagePixels`, 100 million pixels each; `maxImages`, 1 000 different ones) and Markdown (`maxMarkdownLength`, 1 Mi characters) are limited. See docs/errors.md for the errors.
