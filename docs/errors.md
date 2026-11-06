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

A template with problems in its tags or sections gives one `DV_E_TEMPLATE_INVALID` error. Its `errors` list holds every problem found (up to `limits.maxErrors`), each a `DvError` with its own code, place and hint, so that all of them can be fixed in one go.

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
| [`DV_E_INTERNAL`](#dv_e_internal) | A bug in docvane. |

| Warning | What happened |
| --- | --- |
| [`DV_W_SCHEMA_CONFLICT`](#dv_w_schema_conflict) | The same name is used for data of different kinds. |
| [`DV_W_PART_MISSING`](#dv_w_part_missing) | The document refers to a header, footer or notes part that does not exist. |

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
- The template (`TemplateLimits`): `maxTagLength` (length of one tag, braces included; reported inside `DV_E_TEMPLATE_INVALID` with the place of the tag), `maxTags` (tags in the template), `maxSectionDepth` (sections inside sections).

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
The file is a valid package, but not one this version handles: a PowerPoint presentation or an Excel workbook (templates of both are planned), or another kind of document. `details.root` and `details.namespace` name the root element of the main part.
**Fix:** use a Word document (`.docx`, `.docm`, `.dotx` or `.dotm`).

### DV_E_TEMPLATE_INVALID
The template has problems with its tags or sections. `errors` holds each one as a `DvError` with its own code (any `DV_E_TAG_*` or `DV_E_SECTION_*` code below, or `DV_E_LIMIT_EXCEEDED` for a tag longer than `maxTagLength`), place and hint. The `message` and `location` are those of the first problem. `details.count` is the number of problems listed and `details.truncated` is `true` when reading stopped at `limits.maxErrors`.
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
- an operator: `{a > 1}`, `{a == b}`, `{!a}` (not supported in this version);
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
