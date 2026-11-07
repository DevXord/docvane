# Security policy

## Supported versions

| Package | Version | Security fixes |
|---|---|---|
| `docvane` | 1.x | Yes |
| `@docvane/mcp` | 1.x | Yes |

## What docvane promises

docvane treats templates and data as untrusted. A report is a security issue when a template, data, or an argument of the command line or the MCP server can make docvane do one of these:
- write XML that the data was not meant to create (escaping, links, relationships);
- read or write files outside what the caller allowed: the data folder of `docvane render`, or the `--root` directories of `@docvane/mcp`;
- make a network request the caller did not allow (without `fetchImage` in the library, or without `--fetch-images` on the command line);
- use far more time or memory than the limits allow, from a small input;
- run code from a template, or reach object prototypes through expressions.

## Reporting a vulnerability

Report it privately through GitHub: on the [repository page](https://github.com/DevXord/docvane), open **Security**, then **Report a vulnerability**. Please do not open a public issue for it.

Include the version, a template and data that reproduce the problem (as small as you can make them), what happens, and what you expected. You will get an answer in the advisory. Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.
