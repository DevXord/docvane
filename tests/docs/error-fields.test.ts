// CLAUDE.md and phase 6: every error has a code, a place and a hint. The hint is required by the
// type of DvError. This test checks the place: in the sources, every DvError has a location unless
// its code is about the input, the options or the file and the result as a whole; and the errors
// of templates and data that real calls give carry a description of their place.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspect, render, validate, type DvError } from 'docvane';
import { buildDocx, p } from '../helpers/docx';
import { ap, buildPptx, sp } from '../helpers/pptx';
import { buildXlsx } from '../helpers/xlsx';
import { expectDvError } from '../helpers/expect-error';

const SRC = fileURLToPath(new URL('../../packages/docvane/src', import.meta.url));
/** Codes about something without a place in the file: the input, the options, the archive as a whole, the size of the whole result, fetching an image. */
const NO_PLACE = new Set(['DV_E_INVALID_INPUT', 'DV_E_INVALID_OPTION', 'DV_E_NOT_ZIP', 'DV_E_UNSUPPORTED_CONTAINER', 'DV_E_LIMIT_EXCEEDED', 'DV_E_IMAGE_FETCH']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith('.ts') ? [path] : [];
  });
}

/** The text of the arguments of a call that starts at `from` (just after its "("), skipping strings. */
function argumentsAt(text: string, from: number): string {
  let depth = 1;
  let i = from;
  while (i < text.length && depth > 0) {
    const c = text[i] as string;
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    i++;
  }
  return text.slice(from, i);
}

describe('every error has a code, a place and a hint', () => {
  it('in the sources, a DvError has a location unless its code has no place in the file', () => {
    const missing: string[] = [];
    for (const file of sources(SRC)) {
      // The ZIP writer works on docvane's own output; its errors are about the result as a whole.
      if (file.endsWith(join('zip', 'writer.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/new DvError\(\s*'(DV_E_\w+)'/g)) {
        const lineStart = text.lastIndexOf('\n', m.index ?? 0) + 1;
        // Examples in TSDoc comments are not the code that throws.
        if (/^\s*(\*|\/\/)/.test(text.slice(lineStart, m.index ?? 0))) continue;
        const args = argumentsAt(text, (m.index ?? 0) + 'new DvError('.length);
        expect(args, `${file}: ${m[1] as string} without a hint`).toMatch(/\bhint\b/);
        if (!/\blocation\b/.test(args) && !NO_PLACE.has(m[1] as string)) missing.push(`${file.slice(SRC.length)}: ${m[1] as string}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('errors of templates carry the description of their place', () => {
    const errors: DvError[] = [];
    const collect = (fn: () => unknown, code: Parameters<typeof expectDvError>[1]): void => {
      const error = expectDvError(fn, code);
      errors.push(...(error.errors.length > 0 ? error.errors : [error]));
    };
    collect(() => inspect(buildDocx({ body: p('{a') + p('b}') + p('{}') + p('{a +}') + p('{__proto__}') + p('{#x}{/y}') + p('{#a}{#b}{/a}{/b}') + p('{a | nope}') + p('{a | currency}') })), 'DV_E_TEMPLATE_INVALID');
    collect(() => render(buildDocx({ body: p('Items: {#items}') + p('{/items}') }), { items: [] }), 'DV_E_TEMPLATE_INVALID');
    collect(() => render(buildPptx([{ shapes: sp('S', ap('Logo {%logo}')) }]), { logo: 'x' }), 'DV_E_TEMPLATE_INVALID');
    collect(() => inspect(buildXlsx({ Data: { A1: '{%logo}', A2: '{#a}{x}', B3: '{#b}', C3: '{/b}', D4: '{/a}' } })), 'DV_E_TEMPLATE_INVALID');
    const codes = new Set(errors.map((e) => e.code));
    for (const code of ['DV_E_TAG_UNCLOSED', 'DV_E_TAG_UNOPENED', 'DV_E_TAG_EMPTY', 'DV_E_TAG_SYNTAX', 'DV_E_TAG_FORBIDDEN_NAME', 'DV_E_SECTION_UNCLOSED', 'DV_E_SECTION_UNOPENED', 'DV_E_SECTION_MISMATCH', 'DV_E_SECTION_PLACEMENT', 'DV_E_TAG_PLACEMENT', 'DV_E_FORMATTER_UNKNOWN', 'DV_E_FORMATTER_ARGS', 'DV_E_NOT_SUPPORTED']) {
      expect(codes, code).toContain(code);
    }
    for (const e of errors) {
      expect(e.location.description, `${e.code}: ${e.message}`).toBeTruthy();
      expect(e.hint.length, e.code).toBeGreaterThan(0);
    }
  });

  it('errors of data carry the place in the template and the path in the data', () => {
    const template = buildDocx({ body: p('{a.b} {c | number} {#items}{name}{/items}') });
    const { errors } = validate(template, { a: {}, c: 'x', items: [{}] });
    expect(errors.map((e) => e.code)).toEqual(['DV_E_MISSING_FIELD', 'DV_E_INVALID_VALUE', 'DV_E_MISSING_FIELD']);
    for (const e of errors) {
      expect(e.location.description, e.code).toBe('body, paragraph 1');
      expect(e.details['pointer'], e.code).toMatch(/^\//);
      expect(e.hint.length).toBeGreaterThan(0);
    }
  });
});
