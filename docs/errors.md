# Errors and warnings

Every problem docvane reports has a stable code. Errors are thrown as `DvError` (`code`, `message`, `location`, `hint`, `docsUrl`, `details`, `errors`; `error.toJSON()` returns the same as data). Warnings never stop the work; `inspect` lists them in `warnings`.

`location` contains only the fields that are known:

| Field | Meaning |
|---|---|
| `part` | Part name inside the package, for example `/word/document.xml` |
| `story` | `body`, `header`, `footer`, `footnote` or `endnote` |
| `note` | The footnote or endnote, counted from 1 in the order of its part |
| `within` | The table cells (`{ kind: 'table', table, row, cell }`) and text boxes (`{ kind: 'textBox', textBox }`) around the place, outermost first |
| `paragraph` | The paragraph, counted from 1 in its innermost container (the story, a table cell or a text box) |
| `character` | The character of the paragraph text where the tag starts, counted from 1 |
| `description` | The place in words, for example `body, table 1 row 2 cell 1, paragraph 1` |
| `line`, `column` | Inside an XML part |
| `offset` | Byte offset in the file, for ZIP structures |

A template with problems in its tags or sections gives one `DV_E_TEMPLATE_INVALID` error, and data with missing or invalid values one `DV_E_DATA_INVALID` error. Their `errors` list holds every problem found (up to `limits.maxErrors`), each a `DvError` with its own code, place and hint, so that all of them can be fixed in one go.

Codes are never reused for a different condition. New codes are added here first.

## Index

| Code | What happened |
| --- | --- |
| [`DV_E_INVALID_INPUT`](#dv_e_invalid_input) | The input is not what the function expects. |
| [`DV_E_INVALID_OPTION`](#dv_e_invalid_option) | An option is unknown or has a wrong value. |
| [`DV_E_LIMIT_EXCEEDED`](#dv_e_limit_exceeded) | The file or the template exceeds a resource limit. |
| [`DV_E_NOT_ZIP`](#dv_e_not_zip) | The input is not a ZIP archive, so it cannot be an Office document. |
| [`DV_E_UNSUPPORTED_CONTAINER`](#dv_e_unsupported_container) | The input is a Compound File Binary container: a legacy or an encrypted file. |
| [`DV_E_ZIP_CORRUPT`](#dv_e_zip_corrupt) | The ZIP structure is damaged or ambiguous. |
| [`DV_E_ZIP_UNSUPPORTED`](#dv_e_zip_unsupported) | The archive uses a ZIP feature that Office documents do not use. |
| [`DV_E_XML_MALFORMED`](#dv_e_xml_malformed) | An XML part is not well-formed. |
| [`DV_E_XML_DTD_FORBIDDEN`](#dv_e_xml_dtd_forbidden) | An XML part contains a document type declaration. |
| [`DV_E_XML_ENTITY_FORBIDDEN`](#dv_e_xml_entity_forbidden) | An XML part refers to an entity other than the five predefined ones. |
| [`DV_E_XML_ENCODING`](#dv_e_xml_encoding) | An XML part is not valid UTF-8 or UTF-16, or declares another encoding. |
| [`DV_E_PART_MISSING`](#dv_e_part_missing) | A part that the document needs does not exist. |
| [`DV_E_PART_INVALID`](#dv_e_part_invalid) | A packaging part has the wrong structure. |
| [`DV_E_NOT_SUPPORTED`](#dv_e_not_supported) | The file is a kind of document this version does not handle. |
| [`DV_E_TEMPLATE_INVALID`](#dv_e_template_invalid) | The template has problems with its tags or sections; `errors` lists them. |
| [`DV_E_TAG_UNCLOSED`](#dv_e_tag_unclosed) | A `{` has no `}` in the same paragraph before the next `{`. |
| [`DV_E_TAG_UNOPENED`](#dv_e_tag_unopened) | A `}` has no `{` before it. |
| [`DV_E_TAG_EMPTY`](#dv_e_tag_empty) | A tag has no name. |
| [`DV_E_TAG_SYNTAX`](#dv_e_tag_syntax) | A tag does not follow the syntax. |
| [`DV_E_TAG_FORBIDDEN_NAME`](#dv_e_tag_forbidden_name) | A tag uses `__proto__`, `constructor` or `prototype` as a name. |
| [`DV_E_SECTION_UNCLOSED`](#dv_e_section_unclosed) | A section `{#name}` or `{^name}` has no `{/name}`. |
| [`DV_E_SECTION_UNOPENED`](#dv_e_section_unopened) | A `{/name}` closes a section that is not open. |
| [`DV_E_SECTION_MISMATCH`](#dv_e_section_mismatch) | Sections cross: `{/a}` comes before the end of a section opened inside `{#a}`. |
| [`DV_E_SECTION_PLACEMENT`](#dv_e_section_placement) | The tags of a section are placed so that it is not clear what to repeat. |
| [`DV_E_FORMATTER_UNKNOWN`](#dv_e_formatter_unknown) | A tag uses a formatter that does not exist. |
| [`DV_E_FORMATTER_ARGS`](#dv_e_formatter_args) | A formatter has the wrong number or kind of arguments. |
| [`DV_E_DATA_INVALID`](#dv_e_data_invalid) | The data has missing or invalid values; `errors` lists them. |
| [`DV_E_MISSING_FIELD`](#dv_e_missing_field) | The data has no value for a tag. |
| [`DV_E_INVALID_VALUE`](#dv_e_invalid_value) | A value cannot be written or formatted. |
| [`DV_E_IMAGE_FETCH`](#dv_e_image_fetch) | The `fetchImage` function of `renderAsync` failed or returned no bytes. |
| [`DV_E_INTERNAL`](#dv_e_internal) | A bug in docvane. |

| Warning | What happened |
| --- | --- |
| [`DV_W_SCHEMA_CONFLICT`](#dv_w_schema_conflict) | The same name is used for data of different kinds. |
| [`DV_W_PART_MISSING`](#dv_w_part_missing) | The document refers to a header, footer or notes part that does not exist. |
| [`DV_W_STYLE_MISSING`](#dv_w_style_missing) | Markdown or a link needs a style that the template does not have. |

## Errors

### DV_E_INVALID_INPUT
The input is not what the function expects: `inspect` accepts the bytes of the file as a `Uint8Array` (a Node.js `Buffer` is one).
**Fix:** pass the bytes, not a path: `inspect(readFileSync('offer.docx'))`, or in a browser `inspect(new Uint8Array(await file.arrayBuffer()))`.

### DV_E_INVALID_OPTION
An option is unknown or has a wrong type or value. The hint lists the known options and suggests the closest name; `details.option` names the option. A limit must be a whole number greater than 0 or `Infinity` (`maxCompressionRatio`: a number of at least 1).
**Fix:** correct the option name or value.

### DV_E_LIMIT_EXCEEDED
The file or the template exceeds one of the limits (`Limits`). `details.limit` names the limit and `details.value` its current value.

- Reading the file (`ReadLimits`): input size, number of ZIP entries, decompressed size of one entry or of all entries, compression ratio, XML nesting depth, attribute count, name or text length (also of comments and processing instructions), and elements of a part that is parsed into a tree. Sizes are measured on the bytes actually produced by decompression, so a file cannot avoid a limit by declaring false sizes.
- The template (`TemplateLimits`): `maxTagLength` (length of one tag, braces included; reported inside `DV_E_TEMPLATE_INVALID` with the place of the tag), `maxTags` (tags in the template), `maxSectionDepth` (sections inside sections), `maxExpressionDepth` (parentheses and `!` inside one expression, also inside `DV_E_TEMPLATE_INVALID`).
- Rendering: `maxIterations` (how often all sections together repeat their content), `maxOutputBytes` (the size of the rewritten parts, counted while they are built, plus the bytes of added images, so that a small template and small data cannot make a huge document), `maxImageBytes` (one image), `maxImagePixels` (width × height of one image), `maxImages` (different images in one document, and addresses fetched by `renderAsync`) and `maxMarkdownLength` (one Markdown value).

**Fix:** if the file comes from a trusted source and is simply large, raise the named limit, for example `inspect(bytes, { limits: { maxTags: 500_000 } })`. A compression-ratio error on a small file usually means a zip bomb.

### DV_E_NOT_ZIP
The input is not a ZIP archive, so it cannot be an Office document. PDF, RTF, HTML or text files saved with a `.docx` extension give this error.
**Fix:** check what the file really is, and save it as a Word document (`.docx`).

### DV_E_UNSUPPORTED_CONTAINER
The input is a Compound File Binary container (signature `D0 CF 11 E0 A1 B1 1A E1`): either a legacy binary file (`.doc`, `.ppt`, `.xls`) or a password-protected document, which Office stores encrypted inside such a container.
**Fix:** open the file in its application and save it without a password as `.docx`.

### DV_E_ZIP_CORRUPT
The ZIP structure is damaged or ambiguous. `details.reason` says what was found:

| reason | meaning |
|---|---|
| `eocd-missing` | the end of central directory record is missing (usually a truncated download) |
| `trailing-data` | bytes follow the end of central directory record |
| `leading-data` | bytes precede the first entry (self-extracting archive or a file disguised as another format) |
| `central-directory-bounds`, `central-directory-entry`, `central-directory-size` | the central directory is not where it should be or does not match its entries |
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

### DV_E_ZIP_UNSUPPORTED
The archive uses a ZIP feature that Office documents do not use and docvane does not read. `details.reason` is `encrypted` (ZIP encryption), `compression-method` (anything other than stored or Deflate) or `multi-disk` (split or spanned archives).
**Fix:** re-save the document without ZIP encryption and as a single file.

### DV_E_XML_MALFORMED
An XML part is not well-formed: for example a mismatched end tag, a missing root element, an unescaped `&` or `<`, a duplicate attribute, a character that XML does not allow, or an undeclared namespace prefix. `location` gives the part, line and column.
**Fix:** re-save the file in the application that made it; if a program generated it, report the problem to its authors.

### DV_E_XML_DTD_FORBIDDEN
An XML part contains a document type declaration (`<!DOCTYPE …>`). docvane rejects every DTD, which rules out external entities (XXE) and entity-expansion attacks ("billion laughs"). This is a deliberate deviation from XML 1.0, which requires processors to read the internal DTD subset; Office Open XML parts do not use DTDs.
**Fix:** none needed for genuine documents. A file that triggers this error was produced by an unusual tool or crafted on purpose.

### DV_E_XML_ENTITY_FORBIDDEN
An XML part refers to an entity other than the five predefined ones (`&lt;` `&gt;` `&amp;` `&apos;` `&quot;`). Without a DTD such a reference is not well-formed XML. `details.entity` holds the entity name.
**Fix:** re-save the file in the application that made it. Character references such as `&#160;` are always allowed.

### DV_E_XML_ENCODING
An XML part is not valid UTF-8 or UTF-16, or declares another encoding. `details.encoding` holds a declared encoding.
**Fix:** re-save the file in the application that made it.

### DV_E_PART_MISSING
A part that the document needs does not exist: the content types stream (`[Content_Types].xml`; `details.reason` is `missing`, or `interleaved` when it is stored in pieces), the package relationships, or the main document part that the package relationships point to.
**Fix:** the file is incomplete; re-save it in the application that made it.

### DV_E_PART_INVALID
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

**Fix:** check that the file is a Word document and not another ZIP-based format, and re-save it in the application that made it.

### DV_E_NOT_SUPPORTED
The file is a valid package, but not one this version handles: a PowerPoint presentation or an Excel workbook (templates of both are planned), or another kind of document; `details.root` and `details.namespace` name the root element of the main part.
**Fix:** use a Word document (`.docx`, `.docm`, `.dotx` or `.dotm`).

### DV_E_TEMPLATE_INVALID
The template has problems with its tags or sections. `errors` holds each one as a `DvError` with its own code (any `DV_E_TAG_*`, `DV_E_SECTION_*` or `DV_E_FORMATTER_*` code below, or `DV_E_LIMIT_EXCEEDED` for a tag longer than `maxTagLength` or an expression deeper than `maxExpressionDepth`), place and hint. `inspect` and `render` report the same problems; `render` adds `DV_E_SECTION_PLACEMENT`, which depends on where the content to repeat is. The `message` and `location` are those of the first problem. `details.count` is the number of problems listed and `details.truncated` is `true` when reading stopped at `limits.maxErrors`.
**Fix:** fix every problem in `errors`, then run `inspect` again.

### DV_E_TAG_UNCLOSED
A `{` has no `}` after it in the same paragraph, or another `{` comes first. A tag must start and end in the same paragraph; this also happens when a tag is broken by pressing Enter inside it. `details.tag` holds the text from the `{`.
**Fix:** add the missing `}`, or join the paragraph. If a `{` is meant as text, rewrite the text without it: braces are reserved for tags.

### DV_E_TAG_UNOPENED
A `}` has no `{` before it in the same paragraph.
**Fix:** delete the `}` or add the missing `{`.

### DV_E_TAG_EMPTY
A tag has nothing between the braces (`{}`, `{ }`), or only its first character (`{#}`, `{/}`).
**Fix:** write the name of the data, for example `{customer.name}`.

### DV_E_TAG_SYNTAX
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

### DV_E_TAG_FORBIDDEN_NAME
A tag uses `__proto__`, `constructor` or `prototype` as a name or as a formatter. These names reach the internals of JavaScript objects, so docvane refuses them in every template.
**Fix:** rename the field in the template and in the data.

### DV_E_SECTION_UNCLOSED
A section `{#name}` or `{^name}` has no `{/name}` after it in the same part of the document. Sections cannot cross from the body into a header, a footer or the notes.
**Fix:** add `{/name}` after the content of the section.

### DV_E_SECTION_UNOPENED
A `{/name}` closes a section that is not open: there is no `{#name}` or `{^name}` before it in the same part, or it was closed already.
**Fix:** add the opening tag, or delete the closing one.

### DV_E_SECTION_MISMATCH
Sections cross: `{/a}` comes before the end of a section that was opened inside `{#a}`, as in `{#a}{#b}{/a}{/b}`. `details.open` holds the inner section that is still open.
**Fix:** close the inner section first: `{#a}{#b}{/b}{/a}`.

### DV_E_SECTION_PLACEMENT
`render` cannot tell what a section repeats from where its tags are:

- the section spans several paragraphs, but its opening or closing tag shares its paragraph with other text (`Items: {#items}`);
- one tag is inside a table and the other outside it, or they are in different tables;
- one tag is inside a hyperlink, a field or a content control and the other outside it;
- two sections repeat the same table rows.

**Fix:** put the opening and closing tags of a section over several paragraphs each in a paragraph of its own; keep a section that repeats table rows inside one table; keep both tags of a section within one paragraph at the same level.

### DV_E_FORMATTER_UNKNOWN
A tag uses a formatter that does not exist. Only the formatters of the syntax reference can be used (`upper`, `lower`, `capitalize`, `trim`, `default`, `number`, `percent`, `currency`, `date`, `link`); the hint suggests the closest name. `details.formatter` names it.
**Fix:** correct the name.

### DV_E_FORMATTER_ARGS
A formatter has too many or too few arguments, or an argument of the wrong kind: for example `currency` without a currency code, `number("2")` with a string instead of a number, a currency code that is not three letters, more than 20 decimals, or a date pattern with letters that are not fields. The hint shows how to write it.
**Fix:** write the formatter as the hint shows.

### DV_E_DATA_INVALID
The data does not fit the template. `errors` holds each problem (`DV_E_MISSING_FIELD`, `DV_E_INVALID_VALUE`) with its place in the template; `message` and `location` are those of the first. `details.count` is the number listed and `details.truncated` is `true` when collecting stopped at `limits.maxErrors`.
**Fix:** fix the data, or the template, for every problem in `errors`. `inspect` gives the JSON Schema of the data the template needs.

### DV_E_MISSING_FIELD
The data has no value for a tag: a value tag, a loop, or an operand of a comparison. `details.path` is the path that is missing and the hint suggests the closest name found in the data. Only own data properties count: a getter, or a property inherited from a prototype, is missing. A missing condition (`{#isVip}`, `{^isVip}`) is not an error: it counts as false.
**Fix:** add the field to the data, give the tag a default (`{nickname | default("-")}`), or render with `{ missing: 'empty' }` to show nothing for missing values.

### DV_E_INVALID_VALUE
A value cannot be written or formatted:

- an object or a list in a value tag (write one of its fields, or repeat a list with a section);
- a `Date` in a value tag without the `date` formatter;
- a number that is `NaN` or infinite;
- a character that a document cannot hold (control characters other than tab and line breaks, U+FFFE, U+FFFF, unpaired surrogates); the message gives the character and its position;
- a value a formatter cannot format: `number`, `percent` and `currency` need numbers, `date` needs a `Date` or an ISO 8601 text such as `2026-11-06` or `2026-11-06T14:30:00Z`;
- `<`, `<=`, `>` or `>=` between values that are not both numbers or both texts;
- an image that is not a PNG, JPEG or GIF file, a data URL that is not base64 PNG, JPEG or GIF, a width or height that is not a number of centimetres above 0, or alt text that is not text;
- an image given as an http(s) address to `render`, or to `renderAsync` without `fetchImage`: docvane never downloads anything by itself;
- a link (`| link` or a Markdown link) to anything but an absolute `http`, `https` or `mailto` address, or an address with spaces, quotes, angle brackets, backslashes or control characters;
- Markdown with headings, lists or several paragraphs in a tag that shares its paragraph with other text, or a Markdown value that is not text.

**Fix:** correct the value in the data, or use a formatter that fits it. For images from addresses, use `renderAsync` with a `fetchImage` function that decides what may be fetched.

### DV_E_IMAGE_FETCH
The `fetchImage` function passed to `renderAsync` threw (the error is in `cause`) or returned something other than a `Uint8Array` or an `ArrayBuffer`. `details.url` is the address, shortened.
**Fix:** check the address and the function. Bytes it returns are checked like any image (`DV_E_INVALID_VALUE` for a file that is not an image).

### DV_E_INTERNAL
docvane reached a state that should be impossible.
**Fix:** report it with the file and the call that caused it.

## Warnings

### DV_W_SCHEMA_CONFLICT
The same name is used for data of different kinds, for example `{items}` as a value and `{#items}{name}{/items}` as a loop. The schema allows each kind (`anyOf`). `location` is the use that conflicts with an earlier one.
**Fix:** use different names for different data, or use the name the same way everywhere.

### DV_W_PART_MISSING
The document refers to a header, footer, footnotes or endnotes part that does not exist in the package; it was skipped. `location.part` names the missing part.
**Fix:** re-save the document in Word or LibreOffice to repair it.

### DV_W_STYLE_MISSING
Markdown or a link needs a style of the template that it does not have: a paragraph style named "heading 1" to "heading 6", "List Bullet", "List Bullet 2", "List Bullet 3", "List Number", "List Number 2" or "List Number 3", or a character style named "Hyperlink" or "HTML Code" (names compared without regard to letter case). docvane never adds styles of its own: headings keep the style of the tag's paragraph, list items get a "• " or "1. " as text, links and code keep the formatting of the tag. `render` and `renderAsync` pass warnings to the `onWarning` option.
**Fix:** add the style to the template, for example by using it once in Word or LibreOffice and saving.

