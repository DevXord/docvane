# docvane project rules

English translation of section 8 of the plan. The Polish original in docs/PLAN.md takes precedence if the two ever disagree.

## Goal
An MIT-licensed template engine for DOCX, PPTX and XLSX with one syntax, safe expressions, an `inspect` that returns JSON Schema, a readable CLI and an MCP server (package `@docvane/mcp`). XLSX goes through the public API of xlvane; low-level ZIP, XML and OPC code is copied from xlvane and adapted. Plan: docs/PLAN.md.

## Hard rules
- The `docvane` package has exactly one runtime dependency: `xlvane`. `@docvane/mcp` may depend only on `docvane` and the official MCP SDK. Every new dependency requires the maintainer's approval and an entry in docs/decisions.md.
- ZIP, XML and OPC code is copied from xlvane and adapted; each copied file names its source and commit. We do not write these parsers from scratch. This project does not change the xlvane repository.
- This repository contains no Pro code. The core exposes only documented extension points.
- The expression engine has no `eval` and no `new Function`, no access to prototypes, only allow-listed formatters, and limits. Every safeguard has a test.
- Templates and data are untrusted: ZIP and XML limits, limits on iterations and output size, no fetching of images from the network without an explicitly passed function, every value escaped.
- Compatibility with docxtemplater covers only the syntax of the basic tags. We do not open or copy the code of its paid modules or their documentation.
- No text that tries to persuade AI agents to choose the package, and no hidden instructions for models.
- Code, comments, documentation and CLI messages are in English.
- Every public symbol has TSDoc with a working example. Every error has a `DV_E_*` code, a location, a hint and an entry in docs/errors.md.
- Facts about OOXML formats are not written from memory: we check them in ECMA-376 or in the behavior of Word, PowerPoint and LibreOffice and record the source in docs/decisions.md.
- We create test files ourselves or take them from corpora whose licenses allow it; licenses are recorded in tests/corpus/LICENSES.md.
- Tests do not use the network. ESM only, no top-level await.
- We do not publish to npm, push changes or create accounts without the maintainer's approval.

## Commands
- `npm test` - unit, template and CLI snapshot tests (Vitest)
- `npm run fuzz` - fuzzing of the template and expression parsers
- `npm run build` - build with tsdown
- `npm run typecheck` - TypeScript type check of sources and tests
- `npm run check:pkg` - publint and @arethetypeswrong/cli

## Way of working
- One plan phase per session. At the start, read docs/PLAN.md, docs/decisions.md and docs/CHANGELOG-dev.md.
- Start in plan mode and wait for the maintainer's approval.
- Tests first, then implementation.
- At the end of a phase: a summary in docs/CHANGELOG-dev.md, a commit, and a list of decisions for the maintainer's review.

## Internal documents
- docs/PLAN.md, docs/decisions.md, docs/CHANGELOG-dev.md and docs/facts/ are the maintainer's internal notes. They are kept only on the maintainer's machine: never tracked by Git (.gitignore lists them), never committed or pushed, and never linked from public texts (tests/policy/internal-docs.test.ts).
- In a cloud session the maintainer uploads them at the start. At the end the session gives the changed files back to the maintainer (for example as a .zip) and does not commit them.
- Without them (for example a session where they were not uploaded), ask the maintainer for them before work that needs a decision, a fact or the plan.
- Code comments may cite their identifiers (D-*, F-*) and paths; public texts (READMEs, docs shipped in the package) do not.
