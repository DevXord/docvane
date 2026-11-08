// The agent benchmark (bench/agents) is checked here, without agents: every task is solved once
// with tplvane in the way a careful user would, and the checker of the benchmark must accept the
// result. So the tasks can be solved and their checks are right.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspect, preview, render, validate } from 'tplvane';
import { checkTask } from '../../bench/agents/check.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
interface Task {
  readonly id: string;
  readonly files: Record<string, string>;
  readonly checks: readonly import('../../bench/agents/check.mjs').Check[];
}
const { tasks } = JSON.parse(readFileSync(join(ROOT, 'bench/agents/tasks.json'), 'utf8')) as { tasks: Task[] };

const read = (dir: string, name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)));
const json = (dir: string, name: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
const dataUrl = (bytes: Uint8Array): string => 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
const offerData = (dir: string): Record<string, unknown> => ({ ...json(dir, 'data.json'), logo: dataUrl(read(dir, 'logo.png')) });

/** Reference solutions with tplvane. */
const SOLVE: Record<string, (dir: string) => void> = {
  'offer-json': (d) => writeFileSync(join(d, 'offer-anna.docx'), render(read(d, 'offer.docx'), offerData(d))),
  'offer-prose': (d) =>
    writeFileSync(
      join(d, 'offer-jan.docx'),
      render(read(d, 'offer.docx'), {
        logo: dataUrl(read(d, 'logo.png')),
        number: '2026/12/007',
        customer: { name: 'Jan Wiśniewski', company: 'Wiśniewski Meble' },
        date: '2026-12-01',
        items: [
          { name: 'Office chair', qty: 3, price: 349.99, total: 1049.97 },
          { name: 'Oak desk', qty: 1, price: 1200, total: 1200 },
        ],
        sum: 2249.97,
        vip: false,
        notes: 'Delivery in 10 working days.',
        author: 'Anna Nowak',
      }),
    ),
  'offer-locale': (d) => writeFileSync(join(d, 'offer-pl.docx'), render(read(d, 'offer.docx'), offerData(d), { locale: 'pl-PL' })),
  'offer-markdown': (d) => writeFileSync(join(d, 'offer-notes.docx'), render(read(d, 'offer.docx'), { ...offerData(d), notes: '**Delivery is free.**\n\n- Assembly included\n- Two-year warranty\n- Payment within 14 days' })),
  'offer-csv': (d) => {
    const items = readFileSync(join(d, 'items.csv'), 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(','))
      .map(([name, qty, price]) => ({ name, qty: Number(qty), price: Number(price), total: Number(qty) * Number(price) }));
    writeFileSync(join(d, 'offer-csv.docx'), render(read(d, 'offer.docx'), { ...offerData(d), items, sum: items.reduce((s, i) => s + i.total, 0) }));
  },
  'offer-validate': (d) => writeFileSync(join(d, 'problems.txt'), validate(read(d, 'offer.docx'), { ...json(d, 'data-bad.json'), logo: dataUrl(read(d, 'logo.png')) }).errors.map((e) => `${String(e.details['dataPath'])}: ${e.message}`).join('\n')),
  'offer-schema': (d) => writeFileSync(join(d, 'schema.json'), JSON.stringify(inspect(read(d, 'offer.docx')).schema, null, 2)),
  'template-problems': (d) => {
    try {
      inspect(read(d, 'broken.docx'));
    } catch (error) {
      writeFileSync(join(d, 'problems.txt'), (error as { errors: { message: string; location: { description?: string } }[] }).errors.map((e) => `${e.location.description ?? ''}: ${e.message}`).join('\n'));
    }
  },
  basics: (d) => writeFileSync(join(d, 'result.docx'), render(read(d, 'template.docx'), json(d, 'data.json'))),
  stories: (d) => writeFileSync(join(d, 'result.docx'), render(read(d, 'template.docx'), json(d, 'data.json'))),
  slides: (d) => writeFileSync(join(d, 'deck-filled.pptx'), render(read(d, 'deck.pptx'), json(d, 'data.json'))),
  'slides-notes': (d) => writeFileSync(join(d, 'deck-notes.pptx'), render(read(d, 'deck.pptx'), json(d, 'data.json'))),
  workbook: (d) => writeFileSync(join(d, 'sheet-filled.xlsx'), render(read(d, 'sheet.xlsx'), json(d, 'data.json'))),
  'workbook-empty': (d) => writeFileSync(join(d, 'sheet-empty.xlsx'), render(read(d, 'sheet.xlsx'), { ...json(d, 'data.json'), items: [], notes: [] })),
  'check-result': (d) => {
    const bytes = render(read(d, 'offer.docx'), offerData(d));
    writeFileSync(join(d, 'offer-anna.docx'), bytes);
    const text = preview(bytes).text;
    writeFileSync(join(d, 'check.txt'), `${/For Anna Nowak, (.*)/.exec(text)?.[1] ?? ''}\n${/Total: (.*)/.exec(text)?.[1] ?? ''}\n`);
  },
};

describe('agent benchmark tasks', () => {
  it('has 15 to 20 tasks, each with a reference solution', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(15);
    expect(tasks.length).toBeLessThanOrEqual(20);
    expect(Object.keys(SOLVE).sort()).toEqual(tasks.map((t) => t.id).sort());
  });

  it.each(tasks.map((t) => [t.id, t] as const))('%s can be solved and its checks accept the solution', (id, task) => {
    const dir = mkdtempSync(join(tmpdir(), `tplvane-bench-${id}-`));
    for (const [name, source] of Object.entries(task.files)) copyFileSync(join(ROOT, source), join(dir, name));
    (SOLVE[id] as (d: string) => void)(dir);
    expect(checkTask(task, dir, preview)).toEqual([]);
  });

  it('rejects a missing output and a document with a tag left', () => {
    const task = tasks.find((t) => t.id === 'offer-json') as Task;
    const dir = mkdtempSync(join(tmpdir(), 'tplvane-bench-'));
    expect(checkTask(task, dir, preview)).toEqual(['offer-anna.docx: missing']);
    copyFileSync(join(ROOT, 'examples/offer/offer.docx'), join(dir, 'offer-anna.docx'));
    expect(checkTask(task, dir, preview)).toContain('offer-anna.docx: contains "{"');
  });
});
