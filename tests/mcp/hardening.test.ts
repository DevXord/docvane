// Regression tests of the security review of the MCP sandbox (D-061): hard links, FIFOs, writes
// that replace files, paths outside the roots, and the type of the output.
import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTools, Sandbox, type Tool } from '@docvane/mcp';
import { exampleFolder } from '../helpers/cli';

const tool = (dir: string, name: string, allowWrite = true): Tool => createTools(new Sandbox({ roots: [dir], allowWrite })).find((t) => t.name === name) as Tool;
const data = (dir: string): Record<string, unknown> => ({
  ...(JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, unknown>),
  logo: 'data:image/png;base64,' + btoa(String.fromCharCode(...readFileSync(join(dir, 'logo.png')))),
});

describe('MCP sandbox hardening', () => {
  it('refuses to read a file with a hard link to outside the roots', () => {
    const dir = exampleFolder();
    const outside = exampleFolder();
    linkSync(join(outside, 'offer.docx'), join(dir, 'linked.docx'));
    const result = tool(dir, 'inspect_template').handler({ path: 'linked.docx' });
    expect(result.structuredContent).toMatchObject({ error: { code: 'DV_E_FILE_READ', details: { reason: 'hard-link' } } });
  });

  it('replaces a file by renaming a new one over it, so another name of the old file keeps its content', () => {
    const dir = exampleFolder();
    const outside = exampleFolder();
    writeFileSync(join(outside, 'secret.docx'), 'SECRET');
    linkSync(join(outside, 'secret.docx'), join(dir, 'out.docx'));
    const result = tool(dir, 'render').handler({ template: 'offer.docx', data: data(dir), output: 'out.docx', overwrite: true });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(readFileSync(join(outside, 'secret.docx'), 'utf8')).toBe('SECRET');
    expect(readFileSync(join(dir, 'out.docx')).length).toBeGreaterThan(1000);
  });

  it('refuses to write over a FIFO without waiting', () => {
    const dir = exampleFolder();
    expect(spawnSync('mkfifo', [join(dir, 'pipe.docx')], { encoding: 'utf8' }).status).toBe(0);
    const started = Date.now();
    const result = tool(dir, 'render').handler({ template: 'offer.docx', data: data(dir), output: 'pipe.docx', overwrite: true });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.structuredContent).toMatchObject({ error: { code: 'DV_E_FILE_WRITE', details: { reason: 'not-a-file' } } });
  });

  it('gives the same answer for existing and missing files outside the roots, and refuses UNC paths', () => {
    const dir = exampleFolder();
    const t = tool(dir, 'inspect_template', false);
    const exists = t.handler({ path: '/etc/passwd' }).structuredContent as { error: { message: string } };
    const missing = t.handler({ path: '/etc/no-such-file' }).structuredContent as { error: { message: string } };
    expect(exists.error.message.replace('/etc/passwd', 'X')).toBe(missing.error.message.replace('/etc/no-such-file', 'X'));
    expect(t.handler({ path: '\\\\attacker\\share\\x.docx' }).structuredContent).toMatchObject({ error: { code: 'DV_E_FILE_READ' } });
    expect(t.handler({ path: '//attacker/share/x.docx' }).structuredContent).toMatchObject({ error: { code: 'DV_E_FILE_READ' } });
  });

  it('writes only files with the extension of the template', () => {
    const dir = exampleFolder();
    mkdirSync(join(dir, 'home'));
    for (const output of ['.bashrc', 'home/x.sh', 'offer.pptx']) {
      const result = tool(dir, 'render').handler({ template: 'offer.docx', data: data(dir), output, overwrite: true });
      expect(result.structuredContent, output).toMatchObject({ error: { code: 'DV_E_USAGE' } });
    }
  });
});
