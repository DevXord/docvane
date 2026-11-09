// Writes examples/offer/offer.docx, the template of the 5-minute start, from scripts/lib/fixtures.mjs.
// The repository holds no Office files; run this after `npm ci`:
//
//   node scripts/make-example.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { offerDocx } from './lib/fixtures.mjs';

const target = fileURLToPath(new URL('../examples/offer/offer.docx', import.meta.url));
writeFileSync(target, offerDocx());
console.log(`Wrote ${target}`);
