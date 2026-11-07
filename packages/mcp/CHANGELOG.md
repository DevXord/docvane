# Changelog

All notable changes to `@docvane/mcp` are listed here. The version numbers follow semantic versioning and match those of `docvane`.

## Unreleased

The first release.

- An MCP server with the tools `inspect_template`, `validate_data` and `preview_text`, and `render` with `--allow-write`. It serves them over stdio with the official MCP SDK as the `docvane-mcp` command.
- Files are read and written only inside the root directories given with `--root`; links that point out of them are refused, nothing is replaced without `overwrite: true`, and the server downloads nothing.
- `createServer(options)` to connect the server to another transport, and `createTools(sandbox)` for the tools without the SDK.
