# Changelog

All notable changes to `@tplvane/mcp` are listed here. The version numbers follow semantic versioning and match those of `tplvane`.

## Unreleased

- The tool `make_template` (only with `--allow-write`) replaces texts of a finished document with tags and writes the new template inside the root directories, returning the JSON Schema of its data.

## 1.0.1 - 2026-11-10

- Depends on `tplvane` 1.0.1: `inspect_template`, `validate_data` and `render` report the new warning `TV_W_FORMULA_NOT_EXTENDED`, and Word content that repeats a chart or a SmartArt diagram is refused.

## 1.0.0 - 2026-11-08

The first release.

- An MCP server with the tools `inspect_template`, `validate_data` and `preview_text`, and `render` with `--allow-write`. It serves them over stdio with the official MCP SDK as the `tplvane-mcp` command.
- Files are read and written only inside the root directories given with `--root`; links that point out of them are refused (also when a folder is swapped for a link while a file is opened, on Linux), nothing is replaced without `overwrite: true`, `render` writes only files with the extension of the template, and the server downloads nothing.
- `--max-response-chars` limits the whole result, its structured content included.
- `createServer(options)` to connect the server to another transport, and `createTools(sandbox)` for the tools without the SDK.
