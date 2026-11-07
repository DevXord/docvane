# Changelog

All notable changes to `@docvane/mcp` are listed here. The version numbers follow semantic versioning and match those of `docvane`.

## 1.0.0 - 2026-11-07

The first release.

- An MCP server with the tools `inspect_template`, `validate_data` and `preview_text`, and `render` with `--allow-write`. It serves them over stdio with the official MCP SDK as the `docvane-mcp` command.
- Files are read and written only inside the root directories given with `--root`; links that point out of them are refused (also when a folder is swapped for a link while a file is opened, on Linux), nothing is replaced without `overwrite: true`, `render` writes only files with the extension of the template, and the server downloads nothing.
- `--max-response-chars` limits the whole result, its structured content included.
- `createServer(options)` to connect the server to another transport, and `createTools(sandbox)` for the tools without the SDK.
