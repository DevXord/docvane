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

Rendering, formatters, images and Markdown are not implemented in this version; `inspect` already reads all of these tags.

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
body       = expression        (* no sigil, "#" and "^" *)
           | path              (* "%" and "~" *)
           | names ;           (* "/" *)
expression = path , { ws , "|" , ws , formatter } ;
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
- **Operators** such as `>`, `==`, `&&` and `!` are not supported in this version and give an error.
- A **closing tag** names the section exactly: `{/items}` closes `{#items}` or `{^items}`. Formatters on the opening tag are allowed (`{#items | sort}`) and are not repeated on the closing tag. Image and Markdown tags take a path only.

## Sections and scope

- Sections nest: `{#orders}…{#lines}…{/lines}…{/orders}`. Each section must be closed in the same part of the document where it opens: the main text, one header, one footer, or the notes. Sections may span paragraphs, table cells and table rows.
- Inside a section, names refer to the current item first. In `{#lines}{product}{/lines}`, `product` is a field of each line.
- `{.}` is the current item itself: `{#tags}{.}, {/tags}` lists plain values.

## The data schema

`inspect` returns a JSON Schema (draft 2020-12) of the data the template needs. The syntax of a loop and a condition is the same, so `inspect` reads a section from what is inside it:

| In the template | In the schema |
|---|---|
| `{a.b.c}` | `a` and `b` are objects; `c` is a string, a number or a boolean. All three are required. |
| `{#items}…{name}…{/items}` (tags inside) | `items` is a required array of objects with a required `name` |
| `{#tags}{.}{/tags}` | `tags` is a required array of strings, numbers or booleans |
| `{#isVip}…{/isVip}` (no tags inside) | `isVip` is an optional boolean |
| `{^items}…{/items}` alone | `items` is an optional boolean |
| `{%logo}` | `logo` is required; its format is defined with image support |
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

Templates are treated as untrusted. Besides the limits on the ZIP and XML structure, `inspect` limits the length of a tag (`maxTagLength`, 1 024 characters), the number of tags (`maxTags`, 100 000), the nesting of sections (`maxSectionDepth`, 32) and the number of problems it collects (`maxErrors`, 100). See docs/errors.md for the errors.
