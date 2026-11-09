# Agent benchmark

How well does a coding agent fill document templates with tplvane, with docxtemplater and with docx-templates? This folder holds the tasks, the automatic checks, the runner and the results.

## Method

- **Tasks.** `tasks.json` holds 15 tasks that people give agents when working with templates:
  - filling an offer from a JSON file, from a description in words, from a CSV file, with Polish formats and with a Markdown summary;
  - checking data, describing the data a template needs, and finding mistakes in a template;
  - loops, conditions and formatters, headers and footnotes;
  - a presentation with a slide per product and its notes;
  - a workbook whose totals cover every item, and an empty one;
  - checking a result without an office application.

  The templates are the ones of this repository (`examples/offer`, `tests/corpus/libreoffice`) and the generated files in `files/`. The repository holds no Office files: `node scripts/make-example.mjs` writes `examples/offer/offer.docx`, `TV_WRITE_BENCH=1 npx vitest run tests/bench` writes `files/broken.docx`, and the templates of `tests/corpus` come from the maintainer. The runner names any file that is missing.
- **Variants.** The same task text, followed by one sentence that names the library to use (`variants` in `tasks.json`). The sentence for docxtemplater names its free open-source core, without paid modules. Nothing else differs.
- **Runs.** Each run starts in a new folder that holds only the task's files and `TASK.md` with the instructions. The agent is any command that runs without a user interface and reads its instructions on stdin. It may install npm packages in that folder. A run ends when the agent exits, or after `--timeout` seconds.
- **Checks.** `check.mjs` checks the files the run wrote, in the same way for every variant. A document is read as text with tplvane's `preview`, which reads any DOCX, PPTX or XLSX whatever library wrote it, and must contain the expected texts and no tag left. A text file must contain the expected names. The test `tests/bench/tasks.test.ts` solves every task once with tplvane and checks that the checker accepts the result, so the tasks can be solved and their checks are right.
- **Limits of the method.**
  - A variant can fail a task its library does not cover; the result says so.
  - Checks look at the text, not the layout.
  - Results depend on the agent and the model; the results name both.

## Running

```bash
npm ci && npm run build
node bench/agents/run.mjs --price-in <USD> --price-out <USD>   # the plan and the estimated cost, nothing run
node bench/agents/run.mjs --agent "<command>" --tasks offer-json --runs 1 --yes   # a pilot, to measure tokens
node bench/agents/run.mjs --agent "<command>" --yes             # every task, variant and run (3 by default)
node bench/agents/summarize.mjs bench/agents/results/<time>.jsonl
```

The runner prints the number of runs and the estimated cost before running anything. The token counts per run are assumptions (`--tokens-in`, `--tokens-out`) until a pilot measures them. The agent command decides the model, its permissions and its sandbox. Run it in an isolated environment, because the agent installs packages and runs code.

Each run adds one line to `results/<time>.jsonl` with:
- the task, the variant and the run number;
- whether it passed, and the problems found;
- the exit code and the seconds it took;
- tokens and cost, when the agent prints them as JSON (`usage`, `total_cost_usd`);
- the folder of the run.

`summarize.mjs` writes `RESULTS.md` from these files. The raw result files are kept with it.
