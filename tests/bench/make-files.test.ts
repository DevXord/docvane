// Writes the generated input files of the agent benchmark (bench/agents/files): a template with
// problems, data with problems and a CSV of items. Run once with
// `TV_WRITE_BENCH=1 npx vitest run tests/bench`; the files are committed. Skipped otherwise.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { buildDocx, p } from '../helpers/docx';

const dir = fileURLToPath(new URL('../../bench/agents/files/', import.meta.url));

it.skipIf(process.env['TV_WRITE_BENCH'] !== '1')('writes the files', () => {
  writeFileSync(`${dir}broken.docx`, buildDocx({ body: p('Dear {customer.name,') + p('{#items}{name}') + p('Total: {total | currency}') }));
  writeFileSync(`${dir}data-bad.json`, JSON.stringify({ number: '2026/11/002', customer: { nme: 'Ewa Zielińska' }, date: '2026-11-20', items: [{ name: 'Desk', qty: 1, price: 900 }], sum: 900, notes: 'Thank you.', author: 'Jan Kowalski', logo: 'logo.png' }, null, 2));
  const rows = ['name,qty,price'];
  ['Oak desk', 'Office chair', 'Desk lamp', 'Bookshelf', 'Filing cabinet', 'Monitor arm', 'Footrest', 'Whiteboard', 'Coat stand', 'Waste bin'].forEach((name, i) => rows.push(`${name},${String(i + 1)},${String(50 + i * 25)}`));
  writeFileSync(`${dir}items.csv`, `${rows.join('\n')}\n`);
});
