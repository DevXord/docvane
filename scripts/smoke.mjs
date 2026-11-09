// A smoke test of the built package in another runtime: Node.js, Bun or Deno. It loads
// packages/tplvane/dist/index.js and inspects, validates, renders and previews the offer example
// and a PowerPoint and an Excel template, all built by scripts/lib/fixtures.mjs (the repository
// holds no Office files). Used by CI; run it after `npm run build`:
//
//   node scripts/smoke.mjs      bun scripts/smoke.mjs      deno run --allow-read scripts/smoke.mjs
import { readFileSync } from 'node:fs';
import { inspect, preview, render, validate, VERSION } from '../packages/tplvane/dist/index.js';
import { offerDocx, pptxSmoke, PPTX_SMOKE_DATA, xlsxSmoke, XLSX_SMOKE_DATA } from './lib/fixtures.mjs';

const root = new URL('..', import.meta.url);
const read = (path) => new Uint8Array(readFileSync(new URL(path, root)));
const json = (path) => JSON.parse(new TextDecoder().decode(read(path)));
const runtime = typeof globalThis.Deno !== 'undefined' ? `Deno ${globalThis.Deno.version.deno}` : typeof globalThis.Bun !== 'undefined' ? `Bun ${globalThis.Bun.version}` : `Node.js ${process.version}`;

const cases = [
  ['offer.docx', offerDocx(), { ...json('examples/offer/data.json'), logo: 'data:image/png;base64,' + btoa(String.fromCharCode(...read('examples/offer/logo.png'))) }, 'For Anna Nowak, Nowak Design'],
  ['smoke.pptx', pptxSmoke(), PPTX_SMOKE_DATA, 'Offer for Anna Nowak'],
  ['smoke.xlsx', xlsxSmoke(), XLSX_SMOKE_DATA, 'Offer for Anna Nowak'],
];
let failed = 0;
for (const [file, template, data, expected] of cases) {
  try {
    const { format, tags } = inspect(template);
    const check = validate(template, data);
    if (!check.valid) throw new Error(`validate: ${check.errors.map((e) => e.message).join('; ')}`);
    const text = preview(render(template, data)).text;
    if (!text.includes(expected)) throw new Error(`the result does not contain "${expected}"`);
    console.log(`ok   ${file}: ${format}, ${tags.length} tags`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`tplvane ${VERSION} on ${runtime}: ${failed === 0 ? 'all passed' : `${failed} failed`}`);
if (failed > 0) {
  if (typeof globalThis.Deno !== 'undefined') globalThis.Deno.exit(1);
  else process.exitCode = 1;
}
