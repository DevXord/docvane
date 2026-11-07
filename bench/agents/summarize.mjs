// Writes bench/agents/RESULTS.md from result files of run.mjs:
//   node bench/agents/summarize.mjs bench/agents/results/<time>.jsonl [more.jsonl ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const lines = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
if (lines.length === 0) throw new Error('give one or more result files of run.mjs');
const variants = [...new Set(lines.map((l) => l.variant))];
const tasks = [...new Set(lines.map((l) => l.task))];
const rate = (rows) => (rows.length === 0 ? '-' : `${rows.filter((r) => r.passed).length}/${rows.length}`);
const sum = (rows, key) => rows.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0);
const out = ['# Agent benchmark: results', '', `Runs: ${lines.length}, from ${process.argv.slice(2).length} result files. Method: bench/agents/README.md.`, '', `| Task | ${variants.join(' | ')} |`, `|---|${variants.map(() => '---|').join('')}`];
for (const t of tasks) out.push(`| ${t} | ${variants.map((v) => rate(lines.filter((l) => l.task === t && l.variant === v))).join(' | ')} |`);
out.push(`| **All** | ${variants.map((v) => `**${rate(lines.filter((l) => l.variant === v))}**`).join(' | ')} |`, '', '| Variant | Median seconds | Tokens in | Tokens out | Cost (USD) |', '|---|---|---|---|---|');
for (const v of variants) {
  const rows = lines.filter((l) => l.variant === v);
  const seconds = rows.map((r) => r.seconds).sort((a, b) => a - b);
  out.push(`| ${v} | ${seconds[Math.floor(seconds.length / 2)]?.toFixed(0) ?? '-'} | ${sum(rows, 'tokensIn')} | ${sum(rows, 'tokensOut')} | ${sum(rows, 'costUsd').toFixed(2)} |`);
}
out.push('', 'Failed runs and why:', '');
for (const l of lines.filter((r) => !r.passed)) out.push(`- ${l.task}, ${l.variant} #${l.run}: ${l.problems.join('; ')}`);
writeFileSync(join(ROOT, 'bench/agents/RESULTS.md'), `${out.join('\n')}\n`);
console.log('Wrote bench/agents/RESULTS.md');
