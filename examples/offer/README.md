# Offer example

The template, data and image of the 5-minute start in [packages/tplvane/README.md](../../packages/tplvane/README.md#the-command-line-in-5-minutes). The tests of the command line run every example of its help in a copy of this folder.

- `offer.fodt`: the template as flat ODF text, written by hand.
- `offer.docx`: the same, saved by LibreOffice 24.2.7.2:
  `soffice --headless --convert-to "docx:MS Word 2007 XML" offer.fodt`
- `data.json`: data for the template; `"logo": "logo.png"` names the image file next to it.
- `logo.png`: a 160 × 48 picture in two colours, generated for this example.

All files are written for tplvane and licensed under MIT, like the project.
