# `tplvane --json`, version 1

Every `tplvane` command accepts `--json`. The command then prints exactly one JSON document to stdout, without colour, followed by a line feed. When stdout is not a terminal (a pipe, a file, a program reading the output) the document is on one line; on a terminal it is indented with two spaces. The data is the same either way. Notes and warnings, which normally go to stderr, are not printed; warnings are in the document. The exit codes are the same as without `--json`. `--help` and `--version` always print text.

Text in the JSON output is never changed. In the text output for people, control characters from files or arguments (for example the escape character in a file name) are written as `\x1b`, so that a file cannot send commands to the terminal.

The schemas are JSON Schema (draft 2020-12) files in [cli-json/](cli-json/). The tests of tplvane check the output of every command, and of every kind of error, against them. They use only this subset of JSON Schema: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `oneOf`, `anyOf`, `minimum`, `pattern`, and `$ref` to `$defs`.

The field `tplvane` changes only when a field is removed or changes meaning; new fields may be added within a version, so programs should ignore fields they do not know. The schemas list every field of the current release and forbid others, so that the tests notice an undocumented field.

## Envelope

On success:

```json
{ "tplvane": 1, "command": "inspect", "ok": true, "result": { } }
```

On failure:

```json
{
  "tplvane": 1,
  "command": "render",
  "ok": false,
  "error": {
    "name": "TvError",
    "code": "TV_E_FILE_EXISTS",
    "message": "The file \"offer-filled.docx\" already exists.",
    "location": {},
    "hint": "Add --force to replace it, or name another file with --output.",
    "docsUrl": "https://github.com/DevXord/tplvane/blob/main/docs/errors.md#tv_e_file_exists",
    "details": { "path": "offer-filled.docx" },
    "errors": []
  },
  "try": "tplvane render offer.docx data.json --force"
}
```

- **`error`:** the same data as `TvError.toJSON()` in the library. The codes are described in the error catalogue of tplvane (docs/errors.md in the repository). A template with problems gives `TV_E_TEMPLATE_INVALID` and data with problems `TV_E_DATA_INVALID`, each with every problem in `errors`, with its place in the template and, for data, the path of the field (`details.dataPath`, `details.pointer`).
- **`try`:** a ready-to-run command that fixes the error when there is an obvious one (the closest command or option, `--force`, `--fetch-images`), otherwise `null`. It is quoted for POSIX shells.
- **`command`:** `null` when the command itself is unknown.

The error envelope is defined in [cli-json/common.schema.json](cli-json/common.schema.json) (`$defs/errorEnvelope`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | `validate` found problems in the data (the document has `ok: true` and `valid: false`). |
| 2 | Usage error (`TV_E_USAGE`): unknown command or option, missing or extra argument, invalid option value. |
| 3 | Input, file, template or data error: the file cannot be read, is not a template, the template has problems, the data does not fit (`render`), the output exists without `--force`, and so on. |

## Commands

| Command | Schema | `result` |
|---|---|---|
| `inspect` | [cli-json/inspect.schema.json](cli-json/inspect.schema.json) | `file`, and the result of the library's `inspect()`: `format`, `tags` (with `location`), `sections` (a tree), `schema` (the JSON Schema of the data) and `warnings`. |
| `render` | [cli-json/render.schema.json](cli-json/render.schema.json) | `template`, `data` (the file, or `stdin`), `output`, `format`, `bytes` (the size of the result), `written` (`false` with `--dry-run`), `replaced`, `warnings` (for example a style that Markdown needs). |
| `validate` | [cli-json/validate.schema.json](cli-json/validate.schema.json) | `template`, `data`, `valid`, `errors` (as `TvError.toJSON()`, each with its place and the path of the field in the data), `warnings` (including `TV_W_DATA_SCHEMA`). |
| `preview` | [cli-json/preview.schema.json](cli-json/preview.schema.json) | `file`, `format`, `parts` (`name` and `lines` of each story, slide, notes or sheet) and `text` (all parts as plain text). |
| `make-template` | [cli-json/make-template.schema.json](cli-json/make-template.schema.json) | `document`, `map` (the file, or `stdin`), `output`, `bytes`, `written` (`false` with `--dry-run`), `replaced`, `replacements` (for each entry of the map: `find`, `count` and the `locations` of its matches in the original), `schema` (the JSON Schema of the data of the new template) and `warnings`. |
