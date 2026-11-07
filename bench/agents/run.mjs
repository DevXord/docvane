// Runs the agent benchmark: every task of tasks.json, for every variant (docvane, docxtemplater,
// docx-templates), a number of times, each in a fresh folder with only the task's files. The agent
// is any command that runs without a user interface and reads its instructions on stdin, for
// example a coding agent in headless mode. After each run, check.mjs checks the files it wrote.
//
// Without --yes nothing is run: the plan and the estimated cost are printed, so that they can be
// approved first.
//
//   node bench/agents/run.mjs --agent "<command>" [--variants a,b] [--tasks a,b] [--runs 3]
//        [--tokens-in 150000 --tokens-out 10000] [--price-in <USD per million> --price-out <USD per million>]
//        [--timeout 900] [--yes]
//
// Results go to bench/agents/results/<time>.jsonl, one line per run; summarize.mjs writes RESULTS.md.
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { preview } from '../../packages/docvane/dist/index.js';
import { checkTask } from './check.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { tasks, variants } = JSON.parse(readFileSync(join(ROOT, 'bench/agents/tasks.json'), 'utf8'));

const { values } = parseArgs({
  options: {
    agent: { type: 'string' },
    variants: { type: 'string' },
    tasks: { type: 'string' },
    runs: { type: 'string', default: '3' },
    'tokens-in': { type: 'string', default: '150000' },
    'tokens-out': { type: 'string', default: '10000' },
    'price-in': { type: 'string' },
    'price-out': { type: 'string' },
    timeout: { type: 'string', default: '900' },
    yes: { type: 'boolean' },
  },
  strict: true,
});

const pick = (list, all, what) => {
  if (list === undefined) return all;
  const chosen = list.split(',').map((s) => s.trim());
  for (const c of chosen) if (!all.includes(c)) throw new Error(`unknown ${what} "${c}"; known: ${all.join(', ')}`);
  return chosen;
};
const chosenVariants = pick(values.variants, Object.keys(variants), 'variant');
const chosenTasks = pick(values.tasks, tasks.map((t) => t.id), 'task').map((id) => tasks.find((t) => t.id === id));
const runs = Number(values.runs);
const total = chosenTasks.length * chosenVariants.length * runs;
const tokensIn = Number(values['tokens-in']);
const tokensOut = Number(values['tokens-out']);

console.log(`Plan: ${chosenTasks.length} tasks × ${chosenVariants.length} variants (${chosenVariants.join(', ')}) × ${runs} runs = ${total} agent runs.`);
console.log(`Assumed tokens per run (measure them with a pilot of one task, --runs 1): ${tokensIn} in, ${tokensOut} out; in all ${(total * tokensIn / 1e6).toFixed(1)} M in, ${(total * tokensOut / 1e6).toFixed(1)} M out.`);
if (values['price-in'] !== undefined && values['price-out'] !== undefined) {
  const cost = (total * tokensIn * Number(values['price-in']) + total * tokensOut * Number(values['price-out'])) / 1e6;
  console.log(`Estimated cost: ${cost.toFixed(2)} USD at ${values['price-in']} USD per million tokens in and ${values['price-out']} out (prompt caching, if the agent uses it, lowers it).`);
} else {
  console.log('Estimated cost: give --price-in and --price-out (USD per million tokens of the model the agent uses).');
}
if (values.yes !== true) {
  console.log('Nothing was run. Add --yes to run, once the plan and the cost are approved.');
  process.exit(0);
}
if (values.agent === undefined) throw new Error('--agent "<command>" is needed to run');

/** Runs the agent in `dir` with `prompt` on stdin; resolves with its exit code, output and duration. */
function runAgent(dir, prompt) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(values.agent, { cwd: dir, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), Number(values.timeout) * 1000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, seconds: (Date.now() - started) / 1000 });
    });
    child.stdin.end(prompt);
  });
}

/** Token use and cost, when the agent prints them as JSON (for example `usage` and `total_cost_usd`). */
function usageOf(stdout) {
  try {
    const last = JSON.parse(stdout.trim().split('\n').pop() ?? '');
    return { tokensIn: last.usage?.input_tokens ?? null, tokensOut: last.usage?.output_tokens ?? null, costUsd: last.total_cost_usd ?? null };
  } catch {
    return { tokensIn: null, tokensOut: null, costUsd: null };
  }
}

async function main() {
  mkdirSync(join(ROOT, 'bench/agents/results'), { recursive: true });
  const out = join(ROOT, 'bench/agents/results', `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  let n = 0;
  for (const task of chosenTasks) {
    for (const variant of chosenVariants) {
      for (let run = 1; run <= runs; run++) {
        n++;
        const dir = mkdtempSync(join(tmpdir(), `bench-${task.id}-${variant}-`));
        for (const [name, source] of Object.entries(task.files)) copyFileSync(join(ROOT, source), join(dir, name));
        const prompt = `${task.prompt}\n\n${variants[variant]} Work only in the current folder; you may install npm packages there. The task is done when the files it names are written.\n`;
        writeFileSync(join(dir, 'TASK.md'), prompt);
        const result = await runAgent(dir, prompt);
        const problems = checkTask(task, dir, preview);
        const line = { task: task.id, variant, run, passed: problems.length === 0, problems, exitCode: result.code, seconds: result.seconds, ...usageOf(result.stdout), folder: dir };
        appendFileSync(out, `${JSON.stringify(line)}\n`);
        console.log(`[${n}/${total}] ${task.id} ${variant} #${run}: ${line.passed ? 'passed' : `failed (${problems.join('; ')})`} in ${result.seconds.toFixed(0)} s`);
      }
    }
  }
  console.log(`Results: ${out}. Write RESULTS.md with: node bench/agents/summarize.mjs ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
