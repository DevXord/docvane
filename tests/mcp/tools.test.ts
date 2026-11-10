// The tools of @tplvane/mcp, called directly (the MCP SDK is not added yet, D-055): the root
// directories, read-only by default, writing only inside the roots, and the results of each tool.
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTools, Sandbox, type Tool } from '@tplvane/mcp';
import { exampleFolder } from '../helpers/cli';

const DATA = (dir: string): Record<string, unknown> => {
  const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, unknown>;
  // The server takes images only as data URLs.
  return { ...data, logo: 'data:image/png;base64,' + btoa(String.fromCharCode(...readFileSync(join(dir, 'logo.png')))) };
};

function tools(allowWrite = false): { dir: string; tool: (name: string) => Tool; all: Tool[] } {
  const dir = exampleFolder();
  const all = createTools(new Sandbox({ roots: [dir], allowWrite }));
  return { dir, all, tool: (name) => all.find((t) => t.name === name) as Tool };
}

describe('@tplvane/mcp tools', () => {
  it('has read-only tools by default, and render and make_template only with allowWrite', () => {
    expect(tools().all.map((t) => [t.name, t.readOnly])).toEqual([
      ['inspect_template', true],
      ['validate_data', true],
      ['preview_text', true],
    ]);
    expect(tools(true).all.map((t) => t.name)).toEqual(['inspect_template', 'validate_data', 'preview_text', 'render', 'make_template']);
    for (const t of tools(true).all) expect(t.inputSchema.type).toBe('object');
  });

  it('inspect_template returns the schema of the data and the tags with their places', () => {
    const result = tools().tool('inspect_template').handler({ path: 'offer.docx' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent['format']).toBe('docx');
    expect(Object.keys((result.structuredContent['schema'] as { properties: object }).properties)).toContain('customer');
    expect(result.content[0]?.text).toMatch(/^Format: docx\. 16 tags\./);
  });

  it('validate_data lists problems with the path in the data and a hint, from inline data or a file', () => {
    const { dir, tool } = tools();
    const bad = tool('validate_data').handler({ template: 'offer.docx', data: { ...DATA(dir), customer: { nme: 'Anna' } } });
    expect(bad.structuredContent['valid']).toBe(false);
    expect(bad.structuredContent['errors']).toEqual([
      expect.objectContaining({ code: 'TV_E_MISSING_FIELD', dataPath: 'customer.name', pointer: '/customer/name', where: 'body, paragraph 3' }),
      expect.objectContaining({ code: 'TV_E_MISSING_FIELD', dataPath: 'customer.company' }),
    ]);
    expect(bad.content[0]?.text).toContain('Did you mean "nme"?');
    writeFileSync(join(dir, 'data-url.json'), JSON.stringify(DATA(dir)));
    expect(tool('validate_data').handler({ template: 'offer.docx', dataPath: 'data-url.json' }).structuredContent['valid']).toBe(true);
    // A file name is not an image for the server: it downloads and reads nothing on behalf of the data.
    expect(tool('validate_data').handler({ template: 'offer.docx', dataPath: 'data.json' }).structuredContent['valid']).toBe(false);
  });

  it('make_template turns texts of a finished document into tags, writes inside the roots and returns the schema', () => {
    const { dir, tool } = tools(true);
    expect(tool('render').handler({ template: 'offer.docx', data: DATA(dir), output: 'filled.docx' }).isError).toBeUndefined();
    const made = tool('make_template').handler({ document: 'filled.docx', replacements: [{ find: 'Anna Nowak', tag: 'customer.name' }], output: 'made.docx' });
    expect(made.isError).toBeUndefined();
    expect(made.structuredContent['replacements']).toEqual([{ find: 'Anna Nowak', count: 1, where: ['body, paragraph 3'] }]);
    expect(Object.keys((made.structuredContent['schema'] as { properties: object }).properties)).toEqual(['customer']);
    expect(tool('preview_text').handler({ path: 'made.docx' }).content[0]?.text).toContain('For {customer.name}, Nowak Design');
    // Nothing is replaced without overwrite, nothing is written for text that is not there, and only inside the roots.
    expect(tool('make_template').handler({ document: 'filled.docx', replacements: [{ find: 'Anna Nowak', tag: 'a' }], output: 'made.docx' }).isError).toBe(true);
    const missing = tool('make_template').handler({ document: 'filled.docx', replacements: [{ find: 'Ewa', tag: 'a' }], output: 'other.docx' });
    expect((missing.structuredContent['error'] as { code: string }).code).toBe('TV_E_TEXT_NOT_FOUND');
    expect(tool('make_template').handler({ document: 'filled.docx', replacements: [{ find: 'Anna Nowak', tag: 'a' }], output: '../out.docx' }).isError).toBe(true);
    expect(tool('make_template').handler({ document: 'data.json', replacements: [], output: 'x.json' }).isError).toBe(true);
  });

  it('render writes inside the roots, refuses to replace a file without overwrite, and preview_text reads the result', () => {
    const { dir, tool } = tools(true);
    const ok = tool('render').handler({ template: 'offer.docx', data: DATA(dir), output: 'out.docx' });
    expect(ok.isError, ok.content[0]?.text).toBeUndefined();
    expect(tool('preview_text').handler({ path: 'out.docx' }).content[0]?.text).toContain('For Anna Nowak, Nowak Design');
    const again = tool('render').handler({ template: 'offer.docx', data: DATA(dir), output: 'out.docx' });
    expect(again).toMatchObject({ isError: true, structuredContent: { error: { code: 'TV_E_FILE_EXISTS' } } });
    expect(tool('render').handler({ template: 'offer.docx', data: DATA(dir), output: 'out.docx', overwrite: true }).isError).toBeUndefined();
  });

  it('refuses to read or write outside the root directories, also through links', () => {
    const { dir, tool } = tools(true);
    const outside = exampleFolder();
    mkdirSync(join(dir, 'sub'));
    symlinkSync(join(outside, 'offer.docx'), join(dir, 'sub', 'link.docx'));
    symlinkSync(outside, join(dir, 'away'));
    for (const path of ['../x.docx', join(outside, 'offer.docx'), 'sub/link.docx', 'away/offer.docx']) {
      const read = tool('inspect_template').handler({ path });
      expect(read.isError, path).toBe(true);
    }
    expect(tool('inspect_template').handler({ path: join(outside, 'offer.docx') }).structuredContent).toMatchObject({ error: { code: 'TV_E_FILE_READ', details: { reason: 'outside-roots' } } });
    for (const output of [join(outside, 'x.docx'), '../x.docx', 'away/x.docx']) {
      const write = tool('render').handler({ template: 'offer.docx', data: DATA(dir), output });
      expect(write, output).toMatchObject({ isError: true, structuredContent: { error: { code: 'TV_E_FILE_WRITE', details: { reason: 'outside-roots' } } } });
    }
    writeFileSync(join(outside, 'target.docx'), 'x');
    symlinkSync(join(outside, 'target.docx'), join(dir, 'link-out.docx'));
    const throughLink = tool('render').handler({ template: 'offer.docx', data: DATA(dir), output: 'link-out.docx', overwrite: true });
    expect(throughLink.isError).toBe(true);
    expect(readFileSync(join(outside, 'target.docx'), 'utf8')).toBe('x');
  });

  it('a read-only sandbox refuses to write, and the server needs an existing root', () => {
    const dir = exampleFolder();
    expect(() => new Sandbox({ roots: [dir] }).write('x.docx', new Uint8Array(1), false)).toThrow(/read-only/);
    expect(() => new Sandbox({ roots: [] })).toThrow(/at least one root/);
    expect(() => new Sandbox({ roots: [join(dir, 'missing')] })).toThrow(/does not exist/);
  });

  it('returns errors of templates and arguments as results, and cuts long text', () => {
    const dir = exampleFolder();
    const all = createTools(new Sandbox({ roots: [dir] }), { maxResponseChars: 50 });
    const preview = all.find((t) => t.name === 'preview_text') as Tool;
    expect(preview.handler({ path: 'offer.docx' }).content[0]?.text).toMatch(/\[cut: \d+ more characters/);
    expect(preview.handler({}).structuredContent).toMatchObject({ error: { code: 'TV_E_USAGE' } });
    expect(preview.handler({ path: 'data.json' }).structuredContent).toMatchObject({ error: { code: 'TV_E_NOT_ZIP' } });
  });
});
