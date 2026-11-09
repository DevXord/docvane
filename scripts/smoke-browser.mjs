// A smoke test of the built package in a browser (Chromium through Playwright): the page loads
// packages/tplvane/dist/index.js with an import map for xlvane and fflate, then inspects,
// validates, renders and previews the same templates as scripts/smoke.mjs, built in Node by
// scripts/lib/fixtures.mjs. Files are served from the repository and the built templates from
// /fixtures/, by request interception; nothing goes to the network. Run after `npm run build`:
//
//   node scripts/smoke-browser.mjs
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { offerDocx, pptxSmoke, PPTX_SMOKE_DATA, xlsxSmoke, XLSX_SMOKE_DATA } from './lib/fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://tplvane.test';
const FIXTURES = { '/fixtures/offer.docx': offerDocx(), '/fixtures/smoke.pptx': pptxSmoke(), '/fixtures/smoke.xlsx': xlsxSmoke() };
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

const page_ = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"xlvane":"/node_modules/xlvane/dist/index.js","fflate":"/node_modules/fflate/esm/browser.js"}}</script><body>tplvane smoke</body>`;

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === '/') return route.fulfill({ body: page_, contentType: 'text/html' });
      const fixture = FIXTURES[url.pathname];
      if (fixture !== undefined) return route.fulfill({ body: Buffer.from(fixture), contentType: 'application/octet-stream' });
      try {
        const body = readFileSync(root + decodeURIComponent(url.pathname.slice(1)));
        return route.fulfill({ body, contentType: TYPES[extname(url.pathname)] ?? 'application/octet-stream' });
      } catch {
        return route.fulfill({ status: 404, body: 'not found' });
      }
    });
    await page.goto(`${ORIGIN}/`);
    const lines = await page.evaluate(async ({ pptxData, xlsxData }) => {
      const { inspect, preview, render, validate } = await import('/packages/tplvane/dist/index.js');
      const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
      const json = async (path) => (await fetch(path)).json();
      const logo = await bytes('/examples/offer/logo.png');
      const cases = [
        ['/fixtures/offer.docx', { ...(await json('/examples/offer/data.json')), logo }, 'For Anna Nowak, Nowak Design'],
        ['/fixtures/smoke.pptx', pptxData, 'Offer for Anna Nowak'],
        ['/fixtures/smoke.xlsx', xlsxData, 'Offer for Anna Nowak'],
      ];
      const out = [];
      for (const [file, data, expected] of cases) {
        try {
          const template = await bytes(file);
          const { format, tags } = inspect(template);
          const check = validate(template, data);
          if (!check.valid) throw new Error(check.errors.map((e) => e.message).join('; '));
          const text = preview(render(template, data)).text;
          if (!text.includes(expected)) throw new Error(`no "${expected}" in the result`);
          out.push(`ok   ${file}: ${format}, ${tags.length} tags`);
        } catch (error) {
          out.push(`FAIL ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return out;
    }, { pptxData: PPTX_SMOKE_DATA, xlsxData: XLSX_SMOKE_DATA });
    for (const line of lines) console.log(line);
    const failed = lines.filter((l) => l.startsWith('FAIL')).length;
    console.log(`tplvane in ${browser.browserType().name()} ${browser.version()}: ${failed === 0 ? 'all passed' : `${failed} failed`}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
