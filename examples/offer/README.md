# Offer example

The template, data and image of the 5-minute start in [packages/tplvane/README.md](../../packages/tplvane/README.md#the-command-line-in-5-minutes). The tests of the command line run every example of its help in a copy of this folder.

- `offer.docx`: the template. The repository holds no Office files, so it is built in code by `scripts/lib/fixtures.mjs`. Write it here with:
  ```bash
  node scripts/make-example.mjs
  ```
- `data.json`: data for the template; `"logo": "logo.png"` names the image file next to it.
- `logo.png`: a 160 × 48 picture in two colours, generated for this example.

All files are written for tplvane and licensed under MIT, like the project.
