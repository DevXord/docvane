# Licenses of the test files

Every file in `tests/corpus` is listed here with its origin and license. Files from public corpora are added only when their license allows it.

## libreoffice/

Written for docvane and saved by LibreOffice 24.2.7.2 (Linux, headless). The sources are the flat ODF files in `libreoffice/src`; `node scripts/make-corpus-libreoffice.mjs` saves them again as DOCX. The `.inspect.json` files next to them hold what `inspect` is expected to return; `.data.json` files hold data for `render`, and `.render.txt` files the expected text of the result.

| File | What it covers | License |
|---|---|---|
| `split-formatting.docx` | Tags split by bold, italic and underlined parts and by bookmarks; formatters with typographic quotes; loops, conditions, inverted sections, images and Markdown | MIT, same as docvane |
| `stories.docx` | Tags in a table with a loop over rows, a nested table, a text box, the header, the footer, a footnote and an endnote | MIT, same as docvane |
| `pptx-basics.pptx` | A presentation saved by LibreOffice 24.2 from `src/pptx-basics.fodp`: split tags, loops in a shape and a table, a range of slides repeated per product with notes and an image, Markdown and a link | MIT, same as docvane |
| `render-basics.docx` | A template for rendering: split tags, an inline loop, a loop over list items, a loop over table rows, conditions, an expression and formatters | MIT, same as docvane |
