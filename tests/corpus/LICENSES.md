# Licenses of the test files

Every file of the test corpus is listed here with its origin and license. Files from public corpora are added only when their license allows it.

The files are not in the repository, which holds no Office files: the maintainer keeps them, and puts them in `tests/corpus` to run the tests that need them. Without them those tests are skipped.

## libreoffice/

Written for tplvane and saved by LibreOffice 24.2.7.2 (Linux, headless). The sources are the flat ODF files in `libreoffice/src`; `node scripts/make-corpus-libreoffice.mjs` saves them again as DOCX, PPTX and XLSX. The `.inspect.json` files next to them hold what `inspect` is expected to return; `.data.json` files hold data for `render`, and `.render.txt` files the expected text of the result.

| File | What it covers | License |
|---|---|---|
| `split-formatting.docx` | Tags split by bold, italic and underlined parts and by bookmarks; formatters with typographic quotes; loops, conditions, inverted sections, images and Markdown | MIT, same as tplvane |
| `stories.docx` | Tags in a table with a loop over rows, a nested table, a text box, the header, the footer, a footnote and an endnote | MIT, same as tplvane |
| `pptx-basics.pptx` | A presentation saved by LibreOffice 24.2 from `src/pptx-basics.fodp`: split tags, loops in a shape and a table, a range of slides repeated per product with notes and an image, Markdown and a link | MIT, same as tplvane |
| `render-basics.docx` | A template for rendering: split tags, an inline loop, a loop over list items, a loop over table rows, conditions, an expression and formatters | MIT, same as tplvane |
| `xlsx-basics.xlsx` | A workbook saved by LibreOffice 24.2 from `src/xlsx-basics.fods`: typed values, a tag in rich text, a loop over rows with a formula and totals below it, rows that only mark a section, an inline loop and condition, and a second sheet that refers to the totals | MIT, same as tplvane |

## office2007/

Made by the maintainer of tplvane in Microsoft Office 2007 (Polish edition, version 12.0) on 2026-11-09 and saved by Word, PowerPoint and Excel as they are. The document properties and the comment name the person who made them. `.data.json` files hold data for `render`, `.inspect.json` and `.render.txt` the expected results.

| File | What it covers | License |
|---|---|---|
| `word-offer.docx` | Tags in the header and the footer next to a page number, a tag with one bold word, an image, a loop over table rows with a formatter, a condition, a loop within a bulleted list item, Markdown in a "List Number" paragraph, a text box, a footnote, a chart outside sections and a comment | MIT, same as tplvane |
| `word-loop-chart.docx` | A chart between the paragraphs of a loop: filled for one item, refused for more | MIT, same as tplvane |
| `ppt-products.pptx` | A title slide with a date formatter, a slide repeated per product with an image and notes, and a loop over table rows | MIT, same as tplvane |
| `excel-report.xlsx` | A loop over the rows of a table with a formula, a total below them, a date cell and a second sheet that refers to the total | MIT, same as tplvane |

## google/

Made by the maintainer of tplvane in Google Docs, Slides and Sheets on 2026-11-09, with the same content as `office2007/`, and downloaded as `.docx`, `.pptx` and `.xlsx`. The comment names the account that made it. Google Sheets saved the total `SUM(D4:D4)` as `SUM(D4)`, which tplvane reports with `TV_W_FORMULA_NOT_EXTENDED`; Google Docs saved the chart as a picture.

| File | What it covers | License |
|---|---|---|
| `google-offer.docx` | The content of `office2007/word-offer.docx` as Google Docs writes it, with typographic quotes in a formatter and without a "List Number" style | MIT, same as tplvane |
| `google-products.pptx` | The content of `office2007/ppt-products.pptx` as Google Slides writes it | MIT, same as tplvane |
| `google-report.xlsx` | The content of `office2007/excel-report.xlsx` as Google Sheets writes it | MIT, same as tplvane |

## examples/offer/

The offer template of the README, used by the tests of the command line (tests/cli). Written for tplvane and saved by LibreOffice 24.2.7.2; `logo.png` was generated for it. MIT, same as tplvane. See examples/offer/README.md.
