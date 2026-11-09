# Errors and warnings

Every problem tplvane reports has a stable code. Errors are thrown as `TvError` (`code`, `message`, `location`, `hint`, `docsUrl`, `details`, `errors`; `error.toJSON()` returns the same as data). Warnings never stop the work; `inspect` lists them in `warnings`.

`location` contains only the fields that are known:

| Field | Meaning |
|---|---|
| `part` | Part name inside the package, for example `/word/document.xml` |
| `story` | `body`, `header`, `footer`, `footnote`, `endnote`, `slide`, `notes` or `sheet` |
| `slide` | The slide of a presentation, counted from 1 in its order |
| `sheet`, `cell` | The sheet of a workbook by its name, and the cell as an A1 reference |
| `note` | The footnote or endnote, counted from 1 in the order of its part |
| `within` | The table cells (`{ kind: 'table', table, row, cell }`) and text boxes (`{ kind: 'textBox', textBox }`) around the place, outermost first |
| `paragraph` | The paragraph, counted from 1 in its innermost container (the story, a table cell or a text box) |
| `character` | The character of the paragraph text where the tag starts, counted from 1 |
| `description` | The place in words, for example `body, table 1 row 2 cell 1, paragraph 1` |
| `line`, `column` | Inside an XML part |
| `offset` | Byte offset in the file, for ZIP structures |

Every error and warning has a `hint`. Errors about something without a place in the file have an empty `location` and say in `details` what they concern: the input, the options and the command line (`TV_E_INVALID_INPUT`, `TV_E_INVALID_OPTION`, `TV_E_USAGE`, with the option or argument), files as a whole (`TV_E_FILE_READ`, `TV_E_FILE_EXISTS`, `TV_E_FILE_WRITE`, with the path), internal errors (`TV_E_INTERNAL`), the archive as a whole (`TV_E_NOT_ZIP`, `TV_E_UNSUPPORTED_CONTAINER`), limits on the whole file or result (`TV_E_LIMIT_EXCEEDED`, with the limit) and fetching an image (`TV_E_IMAGE_FETCH`, with the address). Every other error has a `location`, and errors of templates and data have its `description`.

## Fields of an error

| Field | Meaning |
|---|---|
| `code` | The stable code, one of the sections below |
| `message` | What happened, in one or two sentences |
| `location` | Where it happened, as above |
| `hint` | What to do next |
| `docsUrl` | The section of this page for the code |
| `details` | Machine-readable details; keys are chosen by tplvane, never taken from the file |
| `errors` | For `TV_E_TEMPLATE_INVALID` and `TV_E_DATA_INVALID`, every problem as its own `TvError` |
| `cause` | The underlying error, if any: an exception of `fetchImage`, or an error of xlvane for workbooks |

Errors about the data (`TV_E_MISSING_FIELD`, `TV_E_INVALID_VALUE`) name the field in `details`:

| Key | Meaning |
|---|---|
| `path` | The path as the tag writes it, for example `name` inside `{#items}` |
| `dataPath` | The place in the data, for example `items[1].name`: lists with the index of the item, up to the first field that is missing |
| `pointer` | The same as a JSON Pointer (RFC 6901), for example `/items/1/name` |
| `available` | For a missing field, the names of the fields of the object where it is missing (up to 20); the hint lists them too |
| `tag` | The tag, shortened |

`validate(template, data)` returns these errors without throwing: `{ valid, errors, warnings, schema }`. `errors` are exactly those `render` would put in `TV_E_DATA_INVALID` for the same data and options; `warnings` add `TV_W_DATA_SCHEMA` where the data does not fit the JSON Schema of `inspect` although `render` accepts it.

A template with problems in its tags or sections gives one `TV_E_TEMPLATE_INVALID` error, and data with missing or invalid values one `TV_E_DATA_INVALID` error. Their `errors` list holds every problem found (up to `limits.maxErrors`), each a `TvError` with its own code, place and hint, so that all of them can be fixed in one go.

Codes are never reused for a different condition. New codes are added here first.

## Index

| Code | What happened |
| --- | --- |
| [`TV_E_INVALID_INPUT`](#tv_e_invalid_input) | The input is not what the function expects. |
| [`TV_E_INVALID_OPTION`](#tv_e_invalid_option) | An option is unknown or has a wrong value. |
| [`TV_E_LIMIT_EXCEEDED`](#tv_e_limit_exceeded) | The file or the template exceeds a resource limit. |
| [`TV_E_NOT_ZIP`](#tv_e_not_zip) | The input is not a ZIP archive, so it cannot be an Office document. |
| [`TV_E_UNSUPPORTED_CONTAINER`](#tv_e_unsupported_container) | The input is a Compound File Binary container: a legacy or an encrypted file. |
| [`TV_E_ZIP_CORRUPT`](#tv_e_zip_corrupt) | The ZIP structure is damaged or ambiguous. |
| [`TV_E_ZIP_UNSUPPORTED`](#tv_e_zip_unsupported) | The archive uses a ZIP feature that Office documents do not use. |
| [`TV_E_XML_MALFORMED`](#tv_e_xml_malformed) | An XML part is not well-formed. |
| [`TV_E_XML_DTD_FORBIDDEN`](#tv_e_xml_dtd_forbidden) | An XML part contains a document type declaration. |
| [`TV_E_XML_ENTITY_FORBIDDEN`](#tv_e_xml_entity_forbidden) | An XML part refers to an entity other than the five predefined ones. |
| [`TV_E_XML_ENCODING`](#tv_e_xml_encoding) | An XML part is not valid UTF-8 or UTF-16, or declares another encoding. |
| [`TV_E_PART_MISSING`](#tv_e_part_missing) | A part that the document needs does not exist. |
| [`TV_E_PART_INVALID`](#tv_e_part_invalid) | A packaging part has the wrong structure. |
| [`TV_E_NOT_SUPPORTED`](#tv_e_not_supported) | The file, or something in it, is not handled by this version. |
| [`TV_E_TEMPLATE_INVALID`](#tv_e_template_invalid) | The template has problems with its tags or sections; `errors` lists them. |
| [`TV_E_TAG_UNCLOSED`](#tv_e_tag_unclosed) | A `{` has no `}` in the same paragraph before the next `{`. |
| [`TV_E_TAG_UNOPENED`](#tv_e_tag_unopened) | A `}` has no `{` before it. |
| [`TV_E_TAG_EMPTY`](#tv_e_tag_empty) | A tag has no name. |
| [`TV_E_TAG_SYNTAX`](#tv_e_tag_syntax) | A tag does not follow the syntax. |
| [`TV_E_TAG_FORBIDDEN_NAME`](#tv_e_tag_forbidden_name) | A tag uses `__proto__`, `constructor` or `prototype` as a name. |
| [`TV_E_SECTION_UNCLOSED`](#tv_e_section_unclosed) | A section `{#name}` or `{^name}` has no `{/name}`. |
| [`TV_E_SECTION_UNOPENED`](#tv_e_section_unopened) | A `{/name}` closes a section that is not open. |
| [`TV_E_SECTION_MISMATCH`](#tv_e_section_mismatch) | Sections cross: `{/a}` comes before the end of a section opened inside `{#a}`. |
| [`TV_E_SECTION_PLACEMENT`](#tv_e_section_placement) | The tags of a section are placed so that it is not clear what to repeat. |
| [`TV_E_TAG_PLACEMENT`](#tv_e_tag_placement) | A tag is in a place where it cannot be rendered, such as an image tag that shares its shape with text. |
| [`TV_E_FORMATTER_UNKNOWN`](#tv_e_formatter_unknown) | A tag uses a formatter that does not exist. |
| [`TV_E_FORMATTER_ARGS`](#tv_e_formatter_args) | A formatter has the wrong number or kind of arguments. |
| [`TV_E_DATA_INVALID`](#tv_e_data_invalid) | The data has missing or invalid values; `errors` lists them. |
| [`TV_E_MISSING_FIELD`](#tv_e_missing_field) | The data has no value for a tag. |
| [`TV_E_INVALID_VALUE`](#tv_e_invalid_value) | A value cannot be written or formatted. |
| [`TV_E_IMAGE_FETCH`](#tv_e_image_fetch) | The `fetchImage` function of `renderAsync` failed or returned no bytes. |
| [`TV_E_USAGE`](#tv_e_usage) | The command line was used wrongly: an unknown command or option, a missing or extra argument. |
| [`TV_E_FILE_READ`](#tv_e_file_read) | The command line cannot read a file. |
| [`TV_E_FILE_EXISTS`](#tv_e_file_exists) | The output file exists and `--force` was not given. |
| [`TV_E_FILE_WRITE`](#tv_e_file_write) | The command line cannot write the output file. |
| [`TV_E_INTERNAL`](#tv_e_internal) | A bug in tplvane. |

| Warning | What happened |
| --- | --- |
| [`TV_W_SCHEMA_CONFLICT`](#tv_w_schema_conflict) | The same name is used for data of different kinds. |
| [`TV_W_PART_MISSING`](#tv_w_part_missing) | The document refers to a header, footer or notes part that does not exist. |
| [`TV_W_STYLE_MISSING`](#tv_w_style_missing) | Markdown or a link needs a style that the template does not have. |
| [`TV_W_DATA_SCHEMA`](#tv_w_data_schema) | `validate`: the data does not fit the schema of the template, but `render` accepts it. |
| [`TV_W_FORMULA_NOT_EXTENDED`](#tv_w_formula_not_extended) | A formula in a workbook refers to a single cell of rows that repeat, so it does not cover the copies. |

## Errors

### TV_E_INVALID_INPUT
The input is not what the function expects: `inspect`, `render`, `validate` and `preview` accept the bytes of the file as a `Uint8Array` (a Node.js `Buffer` is one). On the command line, also a data file that is not UTF-8 text or not valid JSON; the message gives the place of the JSON error.
**Fix:** pass the bytes, not a path: `inspect(readFileSync('offer.docx'))`, or in a browser `inspect(new Uint8Array(await file.arrayBuffer()))`.

### TV_E_INVALID_OPTION
An option is unknown or has a wrong type or value. The hint lists the known options and suggests the closest name; `details.option` names the option. A limit must be a whole number greater than 0 or `Infinity` (`maxCompressionRatio`: a number of at least 1).
**Fix:** correct the option name or value.

### TV_E_LIMIT_EXCEEDED
The file or the template exceeds one of the limits (`Limits`). `details.limit` names the limit and `details.value` its current value.

- Reading the file (`ReadLimits`): input size, number of ZIP entries, decompressed size of one entry or of all entries, compression ratio, XML nesting depth, attribute count, name or text length (also of comments and processing instructions), and elements of a part that is parsed into a tree (`maxXmlTreeElements`, every part tplvane reads, the text of the template included). Sizes are measured on the bytes actually produced by decompression, so a file cannot avoid a limit by declaring false sizes.
- The template (`TemplateLimits`): `maxTagLength` (length of one tag, braces included; reported inside `TV_E_TEMPLATE_INVALID` with the place of the tag), `maxTags` (tags in the template), `maxSectionDepth` (sections inside sections), `maxExpressionDepth` (parentheses and `!` inside one expression, also inside `TV_E_TEMPLATE_INVALID`); one tag also holds at most 256 `&&` and `||`, whatever the limits.
- Rendering: `maxIterations` (how often all sections together repeat their content, checked against the length of a list before any repetition is built; in a workbook, every copy of repeated rows counts), `maxOutputBytes` (the size of the rewritten parts, counted while they are built, plus the bytes of added images, so that a small template and small data cannot make a huge document; in a workbook, the characters of text written into cells and of the cells copied into repeated rows, counted before the rows are built; in a presentation, also the relationships of repeated slides), `maxImageBytes` (one image, also each image `fetchImage` returns, checked as it arrives), `maxImagePixels` (width × height of one image), `maxImages` (different images in one document, and addresses fetched by `renderAsync`), `maxInputBytes` (also all images fetched by `renderAsync` together) and `maxMarkdownLength` (one Markdown value). Markdown is counted against `maxOutputBytes` paragraph by paragraph while it is built. In a workbook with many repeated sections, each reads and writes the whole workbook, and that work counts against `maxOutputBytes`. `preview` counts its text against `maxOutputBytes`.

- Workbooks: xlvane's own limits, such as `maxCells`, also apply when it reads and edits the workbook; `details.xlvaneCode` is then set.

**Fix:** if the file comes from a trusted source and is simply large, raise the named limit, for example `inspect(bytes, { limits: { maxTags: 500_000 } })`. A compression-ratio error on a small file usually means a zip bomb.

### TV_E_NOT_ZIP
The input is not a ZIP archive, so it cannot be an Office document. PDF, RTF, HTML or text files saved with a `.docx` extension give this error.
**Fix:** check what the file really is, and save it as a Word document (`.docx`).

### TV_E_UNSUPPORTED_CONTAINER
The input is a Compound File Binary container (signature `D0 CF 11 E0 A1 B1 1A E1`): either a legacy binary file (`.doc`, `.ppt`, `.xls`) or a password-protected document, which Office stores encrypted inside such a container.
**Fix:** open the file in its application and save it without a password as `.docx`.

### TV_E_ZIP_CORRUPT
The ZIP structure is damaged or ambiguous. `details.reason` says what was found:

| reason | meaning |
|---|---|
| `eocd-missing` | the end of central directory record is missing: the file is truncated, or other bytes were appended after the archive |
| `trailing-data` | bytes follow the end of central directory record |
| `leading-data` | bytes precede the first entry (self-extracting archive or a file disguised as another format) |
| `central-directory-bounds`, `central-directory-entry`, `central-directory-size` | the central directory is not where it should be or does not match its entries; also the reason when other bytes were put before the archive |
| `zip64-locator`, `zip64-record`, `zip64-extra`, `zip64-value` | ZIP64 structures are missing or inconsistent |
| `extra-field` | an extra field runs past its declared length |
| `name-encoding` | an entry name flagged as UTF-8 is not valid UTF-8 |
| `duplicate-name` | two entries have the same name, also when the names differ only in letter case |
| `local-header`, `local-header-mismatch`, `entry-bounds` | a local file header is missing, disagrees with the central directory, or its data runs into the central directory |
| `overlapping-entries` | two entries share bytes, the technique of non-recursive zip bombs |
| `size-mismatch` | an entry decompresses to a different size than its header declares |
| `crc-mismatch` | an entry fails its CRC-32 check |
| `deflate` | an entry is not a valid Deflate stream or ends early |

`location.offset` points at the structure in the file; `details.name` names the entry when known.
**Fix:** re-save the file in the application that made it, or ask the sender for a new copy.

### TV_E_ZIP_UNSUPPORTED
The archive uses a ZIP feature that Office documents do not use and tplvane does not read. `details.reason` is `encrypted` (ZIP encryption), `compression-method` (anything other than stored or Deflate) or `multi-disk` (split or spanned archives).
**Fix:** re-save the document without ZIP encryption and as a single file.

### TV_E_XML_MALFORMED
An XML part is not well-formed: for example a mismatched end tag, a missing root element, an unescaped `&` or `<`, a duplicate attribute, a character that XML does not allow, or an undeclared namespace prefix. `location` gives the part, line and column.
**Fix:** re-save the file in the application that made it; if a program generated it, report the problem to its authors.

### TV_E_XML_DTD_FORBIDDEN
An XML part contains a document type declaration (`<!DOCTYPE …>`). tplvane rejects every DTD, which rules out external entities (XXE) and entity-expansion attacks ("billion laughs"). This is a deliberate deviation from XML 1.0, which requires processors to read the internal DTD subset; Office Open XML parts do not use DTDs.
**Fix:** none needed for genuine documents. A file that triggers this error was produced by an unusual tool or crafted on purpose.

### TV_E_XML_ENTITY_FORBIDDEN
An XML part refers to an entity other than the five predefined ones (`&lt;` `&gt;` `&amp;` `&apos;` `&quot;`). Without a DTD such a reference is not well-formed XML. `details.entity` holds the entity name.
**Fix:** re-save the file in the application that made it. Character references such as `&#160;` are always allowed.

### TV_E_XML_ENCODING
An XML part is not valid UTF-8 or UTF-16, or declares another encoding. `details.encoding` holds a declared encoding.
**Fix:** re-save the file in the application that made it.

### TV_E_PART_MISSING
A part that the document needs does not exist: the content types stream (`[Content_Types].xml`; `details.reason` is `missing`, or `interleaved` when it is stored in pieces), the package relationships, or the main document part that the package relationships point to.
**Fix:** the file is incomplete; re-save it in the application that made it.

### TV_E_PART_INVALID
A packaging part exists but has the wrong structure. `details.reason` says what is wrong:

| reason | meaning |
|---|---|
| `root-element` | the content types or relationships part has the wrong root element or namespace |
| `missing-attribute` | a required attribute (for example `Id`, `Type`, `Target`, `PartName`, `ContentType`) is missing |
| `duplicate-default`, `duplicate-override` | the content types stream declares the same extension or part twice |
| `duplicate-id` | two relationships in one part have the same `Id` |
| `target-mode` | `TargetMode` is neither `Internal` nor `External` |
| `internal-target` | an internal relationship target cannot be resolved to a part name |
| `equivalent-part-names` | two ZIP entries map to equivalent part names (for example a raw UTF-8 name and its percent-encoded form) |

In a workbook, xlvane reads and edits the sheets, and an error of xlvane that has no tplvane code of its own, such as a sheet it cannot read, gives this code with `details.xlvaneCode` and xlvane's error in `cause`.

**Fix:** check that the file is a Word document, a presentation or a workbook and not another ZIP-based format, and re-save it in the application that made it.

### TV_E_NOT_SUPPORTED
Something this version does not handle:

- a package that is not a Word document, a PowerPoint presentation or an Excel workbook; `details.root` and `details.namespace` name the root element of the main part;
- in an Excel template, an image tag, a Markdown tag or the `link` formatter (reported inside `TV_E_TEMPLATE_INVALID`, with the cell);
- in an Excel template, an array formula or a data table in rows that a section repeats, an array formula elsewhere whose range the copies would extend (reported inside `TV_E_TEMPLATE_INVALID`, also by `inspect`), or a formula whose references cannot be moved safely; the location names the cell;
- in a document, a footnote or endnote in content that repeats: a note belongs to one place, and its text would show the data of the root;
- in a document, a chart or a SmartArt diagram in content that repeats more than once: each chart and each diagram needs a part of its own, which copies do not get; `details.element` is `chart` or `relIds`;
- in a presentation, repeating a slide that has a chart, SmartArt, comments or an embedded object, which the copies would share; `details.relationship` names the kind of part;
- a change xlvane refuses in a workbook, for example inserting rows into a sheet with a chart, a pivot table or other objects that refer to cells. The message says what tplvane was doing and repeats xlvane's message; `details.xlvaneCode` is xlvane's code and `cause` its error.

For problems that depend on the data (a note, a chart or a diagram in content that repeats, a slide repeated with a chart), `validate` lists the error in `errors` instead of throwing it.

**Fix:** use a Word document (`.docx`, `.docm`, `.dotx`, `.dotm`), a PowerPoint presentation (`.pptx`) or an Excel workbook (`.xlsx`); in Excel templates, write values without images, Markdown and links, and keep array formulas, charts and pivot tables away from sheets whose rows repeat.

### TV_E_TEMPLATE_INVALID
The template has problems with its tags or sections. `errors` holds each one as a `TvError` with its own code (any `TV_E_TAG_*`, `TV_E_SECTION_*` or `TV_E_FORMATTER_*` code below, `TV_E_NOT_SUPPORTED` for what Excel templates cannot do yet, or `TV_E_LIMIT_EXCEEDED` for a tag longer than `maxTagLength` or an expression deeper than `maxExpressionDepth`), place and hint. `inspect` and `render` report the same problems of tags and sections; `render` and `validate` add the problems that depend on the structure of the document around the tags: `TV_E_SECTION_PLACEMENT` (where the content to repeat is) and `TV_E_TAG_PLACEMENT` (an image shape on a slide). Use `validate` to check a template completely without data of your own: `validate(template, {})` reports them before the missing fields. The `message` and `location` are those of the first problem. `details.count` is the number of problems listed and `details.truncated` is `true` when reading stopped at `limits.maxErrors`.
**Fix:** fix every problem in `errors`, then run `inspect` again.

### TV_E_TAG_UNCLOSED
A `{` has no `}` after it in the same paragraph, or another `{` comes first. A tag must start and end in the same paragraph; this also happens when a tag is broken by pressing Enter inside it. `details.tag` holds the text from the `{`.
**Fix:** add the missing `}`, or join the paragraph. If a `{` is meant as text, rewrite the text without it: braces are reserved for tags.

### TV_E_TAG_UNOPENED
A `}` has no `{` before it in the same paragraph.
**Fix:** delete the `}` or add the missing `{`.

### TV_E_TAG_EMPTY
A tag has nothing between the braces (`{}`, `{ }`), or only its first character (`{#}`, `{^}`, `{%}`, `{~}`). `{/}` is not empty: it closes the innermost open section.
**Fix:** write the name of the data, for example `{customer.name}`.

### TV_E_TAG_SYNTAX
A tag does not follow the syntax (docs/syntax.md). `details.tag` holds the tag and `details.position` the character of the tag where the problem is, counted from 1 at the `{`. Common causes:

- a name with a character names cannot have, such as `-` or a space: `{first-name}`, `{first name}` (use `firstName` or `first_name`);
- arithmetic, a function call, indexing or a conditional: `{a + 1}`, `{f(x)}`, `{a[0]}`, `{a ? b : c}` (the operators are `==` `!=` `<` `<=` `>` `>=` `&&` `||` `!` and parentheses);
- `=` instead of `==`, or chained comparisons such as `{a < b < c}`;
- a formatter argument that is not a literal: `{x | f(y)}`;
- a string argument without its closing quote;
- a formatter on a closing, image or Markdown tag: `{/items | sort}`, `{%logo | f}`;
- a tab, a line break or an inline object (an image, a symbol, a note mark) inside a tag;
- `{.}`, the current item, outside a section.

**Fix:** follow the hint; it names what was expected at the position.

### TV_E_TAG_FORBIDDEN_NAME
A tag uses `__proto__`, `constructor` or `prototype` as a name or as a formatter. These names reach the internals of JavaScript objects, so tplvane refuses them in every template.
**Fix:** rename the field in the template and in the data.

### TV_E_SECTION_UNCLOSED
A section `{#name}` or `{^name}` has no `{/name}` after it in the same part of the document. Sections cannot cross from the body into a header, a footer or the notes.
**Fix:** add `{/name}` after the content of the section.

### TV_E_SECTION_UNOPENED
A `{/name}` closes a section that is not open: there is no `{#name}` or `{^name}` before it in the same part, or it was closed already.
**Fix:** add the opening tag, or delete the closing one.

### TV_E_SECTION_MISMATCH
Sections cross: `{/a}` comes before the end of a section that was opened inside `{#a}`, as in `{#a}{#b}{/a}{/b}`. `details.open` holds the inner section that is still open.
**Fix:** close the inner section first: `{#a}{#b}{/b}{/a}`.

### TV_E_SECTION_PLACEMENT
`render` cannot tell what a section repeats from where its tags are:

- the section spans several paragraphs, but its opening or closing tag shares its paragraph with other text (`Items: {#items}`);
- one tag is inside a table and the other outside it, or they are in different tables;
- one tag is inside a hyperlink, a field or a content control and the other outside it;
- two sections repeat the same table rows, or the repeated rows of a slide table have cells merged down (`rowSpan`; the copies would overlap);
- in a presentation, a section opens and closes on different slides, but its tags do not each fill a shape of their own (only such sections repeat slides), or a section that repeats slides is inside one that does not, or two sections that repeat slides at the same level share a slide; or the two tags of a section are in different shapes of one slide;
- in a workbook, a section that repeats rows is inside another one that repeats rows, starts in a row the section before it repeats, or a tag outside the section is in one of its rows (the whole row repeats). `inspect` reports these too.

**Fix:** put the opening and closing tags of a section over several paragraphs each in a paragraph of its own; keep a section that repeats table rows inside one table; keep both tags of a section within one paragraph at the same level.

### TV_E_TAG_PLACEMENT
A tag is in a place where it cannot be rendered. On a slide, an image tag takes the place of its shape, so it must be the whole text of the shape, and the shape needs a position and size of its own (`a:xfrm`; placeholders that inherit them from the layout do not have one).
It is a problem of the template, reported whatever the data (also when the image is `null`).
**Fix:** put the image tag alone in a text box of the size the image should have.

### TV_E_FORMATTER_UNKNOWN
A tag uses a formatter that does not exist. Only the formatters of the syntax reference can be used (`upper`, `lower`, `capitalize`, `trim`, `default`, `number`, `percent`, `currency`, `date`, `link`); the hint suggests the closest name. `details.formatter` names it.
**Fix:** correct the name.

### TV_E_FORMATTER_ARGS
A formatter has too many or too few arguments, or an argument of the wrong kind: for example `currency` without a currency code, `number("2")` with a string instead of a number, a currency code that is not three letters, more than 20 decimals, or a date pattern with letters that are not fields. The hint shows how to write it.
**Fix:** write the formatter as the hint shows.

### TV_E_DATA_INVALID
The data does not fit the template. `errors` holds each problem (`TV_E_MISSING_FIELD`, `TV_E_INVALID_VALUE`) with its place in the template; `message` and `location` are those of the first. `details.count` is the number listed and `details.truncated` is `true` when collecting stopped at `limits.maxErrors`.
**Fix:** fix the data, or the template, for every problem in `errors`. `inspect` gives the JSON Schema of the data the template needs.

### TV_E_MISSING_FIELD
The data has no value for a tag: a value tag, a loop, or an operand of a comparison. `details.path` is the path as the tag writes it, `details.dataPath` and `details.pointer` the place in the data (`items[1].name`, `/items/1/name`), and `details.available` the fields of the object where it is missing; the hint suggests the closest name and lists those fields. Only own data properties count: a getter, or a property inherited from a prototype, is missing. A missing condition (`{#isVip}`, `{^isVip}`) is not an error: it counts as false.
**Fix:** add the field to the data, give the tag a default (`{nickname | default("-")}`), or render with `{ missing: 'empty' }` to show nothing for missing values.

### TV_E_INVALID_VALUE
A value cannot be written or formatted:

- an object or a list in a value tag (write one of its fields, or repeat a list with a section);
- a `Date` in a value tag without the `date` formatter;
- a number that is `NaN` or infinite;
- a character that a document cannot hold (control characters other than tab and line breaks, U+FFFE, U+FFFF, unpaired surrogates); the message gives the character and its position;
- in a workbook, text of more than 32 767 characters for one cell, or an invalid `Date`;
- a value a formatter cannot format: `number`, `percent` and `currency` need numbers, `date` needs a `Date` or an ISO 8601 text such as `2026-11-06` or `2026-11-06T14:30:00Z`;
- `<`, `<=`, `>` or `>=` between values that are not both numbers or both texts;
- an image that is not a PNG, JPEG or GIF file, a data URL that is not base64 PNG, JPEG or GIF, a width or height that is not a number of centimetres above 0, or alt text that is not text;
- an image given as an http(s) address to `render`, or to `renderAsync` without `fetchImage`: tplvane never downloads anything by itself;
- a link (`| link` or a Markdown link) to anything but an absolute `http`, `https` or `mailto` address, or an address with spaces, quotes, angle brackets, backslashes or control characters;
- Markdown with headings, lists or several paragraphs in a tag that shares its paragraph with other text, or a Markdown value that is not text.

When the tag is a plain path, `details.dataPath` and `details.pointer` give the place of the value in the data.

**Fix:** correct the value in the data, or use a formatter that fits it. For images from addresses, use `renderAsync` with a `fetchImage` function that decides what may be fetched.

### TV_E_IMAGE_FETCH
The `fetchImage` function passed to `renderAsync` threw (the error is in `cause`) or returned something other than a `Uint8Array` or an `ArrayBuffer`. `details.url` is the address, shortened.
**Fix:** check the address and the function. Bytes it returns are checked like any image (`TV_E_INVALID_VALUE` for a file that is not an image). With the command line (`--fetch-images`), the message of the download error is in `cause`: an HTTP status other than 200, a redirect to another host, an image larger than `maxImageBytes`, or no answer within 30 seconds.

### TV_E_USAGE
The command line was used wrongly: an unknown command or option (the hint suggests the closest one), a string option without its value, a value that is not one of the allowed ones (also an invalid `--locale`, `--time-zone` or `--delimiters`, checked before any file is read), `--output -`, or a missing or extra argument. The MCP server gives it for an output whose extension is not that of the template, after `.` and `..` in the paths are resolved. The exit code is 2. `details` names the `command`, `option` or `argument`; with `--json`, `try` holds the corrected command when there is an obvious one.
**Fix:** run `tplvane help <command>` and use one of its examples.

### TV_E_FILE_READ
The command line or the MCP server cannot read a file: it does not exist, it is not a regular file (a folder, a device or a pipe), it is larger than 256 MiB (the command line reads at most that from a file or stdin), or it may not be read. `details.path` is the path as given and `details.reason` the system code (`ENOENT`, `ENOTREG`, `EFBIG`, `EACCES`, …) or, for the MCP server, `outside-roots` (the path is outside the root directories, or does not exist: the server does not say which), `not-a-file` (a folder, a device or a pipe) or `hard-link` (the file has more than one name, and one of them may be outside the roots). Also an image file named in the data that is not found next to the data file. Image files with more than one name (hard links), or that lie outside the folder of the data file once opened (a folder swapped for a link), are refused as invalid values.
**Fix:** check the name and the folder; paths are relative to the current directory, image files to the folder of the data file.

### TV_E_FILE_EXISTS
`tplvane render` would write a file that already exists, and `--force` was not given. `details.path` names it; `try` is the same command with `--force`.
**Fix:** add `--force` to replace the file, or name another file with `--output`.

### TV_E_FILE_WRITE
The command line or the MCP server cannot write the output file, for example because its folder does not exist or may not be written. `details.path` and `details.reason` as for `TV_E_FILE_READ`; `ELINK` when the command line's output is a link (it does not write through links); for the MCP server also `read-only` (started without `--allow-write`), `link` (the output is a link), `not-a-file` and `outside-roots` (outside the root directories, or its folder does not exist: the server does not say which). Both replace a file by writing a new file and renaming it over the old one, so the old file is never changed in place; the MCP server keeps its permissions.
**Fix:** check that the folder exists and that you may write there.

### TV_E_INTERNAL
tplvane reached a state that should be impossible.
**Fix:** report it with the file and the call that caused it.

## Warnings

### TV_W_SCHEMA_CONFLICT
The same name is used for data of different kinds, for example `{items}` as a value and `{#items}{name}{/items}` as a loop. The schema allows each kind (`anyOf`). `location` is the use that conflicts with an earlier one.
**Fix:** use different names for different data, or use the name the same way everywhere.

### TV_W_PART_MISSING
The document refers to a header, footer, footnotes or endnotes part that does not exist in the package; it was skipped. `location.part` names the missing part.
**Fix:** re-save the document in Word or LibreOffice to repair it.

### TV_W_STYLE_MISSING
Markdown or a link needs a style of the template that it does not have: a paragraph style named "heading 1" to "heading 6", "List Bullet", "List Bullet 2", "List Bullet 3", "List Number", "List Number 2" or "List Number 3", or a character style named "Hyperlink" or "HTML Code" (names compared without regard to letter case). tplvane never adds styles of its own: headings keep the style of the tag's paragraph, list items get a "• " or "1. " as text, links and code keep the formatting of the tag. `render` and `renderAsync` pass warnings to the `onWarning` option.
**Fix:** add the style to the template, for example by using it once in Word or LibreOffice and saving.

### TV_W_DATA_SCHEMA
Reported by `validate` and `templateSchema`: the data does not fit the JSON Schema that `inspect` returns, but `render` accepts it with this data, so `valid` stays `true`. Typical cases: a field used only in a section that this data does not show (`{#isVip}{discount}{/isVip}` with `isVip` false), a condition given a value other than a boolean (`render` tests any value for truth), an object where the schema reads a section with tags inside as a loop, or `null` for a value (`render` shows nothing). `details.pointer` and `details.dataPath` name the field, `details.kind` is `missing` or `type`, `details.expected` the kinds the schema allows; `location` is where the field is first used in the template.
**Fix:** nothing fails now. Add the field, or pass the kind the schema names, if the data should also fit other data of the same template or tools that read the schema.

### TV_W_FORMULA_NOT_EXTENDED
A formula of a workbook, outside the rows that a section repeats, refers to a single cell of those rows, for example `=SUM(D4)` below `{#rows}` in row 4. Only ranges whose last row is the last repeated row grow to the last copy; a single cell stays where it is, so the formula keeps using the first item. Google Sheets writes `=SUM(D4:D4)` as `=SUM(D4)`. Reported by `inspect`, `validate` and `render` (through `onWarning`), at most `maxErrors` times; `location` is the cell of the formula, and `details` holds the `formula`, the `reference` and the opening tag of the `section`. The formula is written as it is.
**Fix:** refer to a range that ends on the last repeated row, such as `D4:D4`, or, in Google Sheets, one that starts a row higher: `D3:D4` (text in the header row is not added up). Leave the formula if it should use the first item only.
