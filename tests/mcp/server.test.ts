// Phase 8 acceptance: the docvane MCP server tested with the official MCP client over an in-memory
// transport. Tools are listed with their schemas and annotations, read-only by default; render
// writes only inside the root directories; arguments are checked against the input schemas.
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer, type ServerOptions } from '@docvane/mcp';
import { exampleFolder } from '../helpers/cli';

const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
});

async function connect(options: ServerOptions): Promise<Client> {
  const server = createServer(options);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'docvane-test', version: '0.0.0' });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

const dataWithLogo = (dir: string): Record<string, unknown> => ({
  ...(JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, unknown>),
  logo: 'data:image/png;base64,' + btoa(String.fromCharCode(...readFileSync(join(dir, 'logo.png')))),
});

type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

describe('@docvane/mcp server over the MCP client', () => {
  it('lists read-only tools by default, with schemas and annotations', async () => {
    const client = await connect({ roots: [exampleFolder()] });
    const { tools } = await client.listTools();
    expect(tools.map((t) => [t.name, t.annotations?.readOnlyHint])).toEqual([
      ['inspect_template', true],
      ['validate_data', true],
      ['preview_text', true],
    ]);
    expect(tools[0]?.inputSchema).toMatchObject({ type: 'object', required: ['path'] });
  });

  it('adds render with allowWrite, marked as writing', async () => {
    const client = await connect({ roots: [exampleFolder()], allowWrite: true });
    const render = (await client.listTools()).tools.find((t) => t.name === 'render');
    expect(render?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
  });

  it('inspects, validates, renders and previews through tool calls', async () => {
    const dir = exampleFolder();
    const client = await connect({ roots: [dir], allowWrite: true });
    const inspected = (await client.callTool({ name: 'inspect_template', arguments: { path: 'offer.docx' } })) as Result;
    expect(inspected.structuredContent?.['format']).toBe('docx');
    const invalid = (await client.callTool({ name: 'validate_data', arguments: { template: 'offer.docx', data: { customer: {} } } })) as Result;
    expect(invalid.structuredContent?.['valid']).toBe(false);
    expect(invalid.content[0]?.text).toContain('customer.name');
    const rendered = (await client.callTool({ name: 'render', arguments: { template: 'offer.docx', data: dataWithLogo(dir), output: 'out.docx' } })) as Result;
    expect(rendered.isError, rendered.content[0]?.text).toBeFalsy();
    const preview = (await client.callTool({ name: 'preview_text', arguments: { path: 'out.docx' } })) as Result;
    expect(preview.content[0]?.text).toContain('For Anna Nowak, Nowak Design');
  });

  it('refuses writing outside the root directories, through links and over files', async () => {
    const dir = exampleFolder();
    const outside = exampleFolder();
    mkdirSync(join(dir, 'sub'));
    symlinkSync(outside, join(dir, 'sub', 'away'));
    const client = await connect({ roots: [dir], allowWrite: true });
    for (const output of [join(outside, 'x.docx'), '../x.docx', 'sub/away/x.docx']) {
      const result = (await client.callTool({ name: 'render', arguments: { template: 'offer.docx', data: dataWithLogo(dir), output } })) as Result;
      expect(result.isError, output).toBe(true);
      expect(result.structuredContent?.['error']).toMatchObject({ code: 'DV_E_FILE_WRITE', details: { reason: 'outside-roots' } });
    }
    const over = (await client.callTool({ name: 'render', arguments: { template: 'offer.docx', data: dataWithLogo(dir), output: 'offer.docx' } })) as Result;
    expect(over.structuredContent?.['error']).toMatchObject({ code: 'DV_E_FILE_EXISTS' });
  });

  it('does not offer render to a read-only server, and checks arguments against the schemas', async () => {
    const client = await connect({ roots: [exampleFolder()] });
    const render = (await client.callTool({ name: 'render', arguments: { template: 'offer.docx', data: {}, output: 'x.docx' } }).catch((error: unknown) => ({ isError: true, content: [{ type: 'text', text: String(error) }] }))) as Result;
    expect(render.isError).toBe(true);
    const wrong = (await client.callTool({ name: 'inspect_template', arguments: { file: 'offer.docx' } })) as Result;
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0]?.text).toMatch(/path|additional/);
  });
});
