# Licenses of the test files

Every file in `tests/corpus` is listed here with its origin and license. Files from public corpora are added only when their license allows it.

## libreoffice/

Written for docvane and saved by LibreOffice 24.2.7.2 (Linux, headless). The sources are the flat ODF files in `libreoffice/src`; `node scripts/make-corpus-libreoffice.mjs` saves them again as DOCX. The `.inspect.json` files next to them hold what `inspect` is expected to return.

| File | What it covers | License |
|---|---|---|
| `split-formatting.docx` | Tags split by bold, italic and underlined parts and by bookmarks; formatters with typographic quotes; loops, conditions, inverted sections, images and Markdown | MIT, same as docvane |
| `stories.docx` | Tags in a table with a loop over rows, a nested table, a text box, the header, the footer, a footnote and an endnote | MIT, same as docvane |
