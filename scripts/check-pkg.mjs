// `npm run check:pkg`: builds every package and checks it the way a consumer sees it.
//
// 1. publint --strict (warnings count as errors)
// 2. attw --pack <dir> --profile esm-only (types resolve for ESM consumers; CJS is not supported)
// 3. Every file in dist loads with require(): Node.js throws ERR_REQUIRE_ASYNC_MODULE for a
//    module graph with top-level await, which CLAUDE.md forbids. The bins (cli.js) run as programs.
// 4. Every tarball contains the built entry point, the README and the license.
// 5. The docvane command runs from the build: --version, and inspect and render of examples/offer
//    in a temporary folder.
// 6. No built file names an internal document (CLAUDE.md, "Internal documents"), and the shipped
//    declarations, whose TSDoc readers see, cite no internal decision or fact identifiers.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = ['packages/docvane', 'packages/mcp'];
const failures = [];

function run(label, command) {
  console.log(`\n> ${label}`);
  // shell: true so that the npm/npx .cmd shims also run on Windows.
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) failures.push(label);
}

run('build', 'npm run build');
if (failures.length === 0) {
  for (const dir of packages) {
    run(`publint ${dir}`, `npx publint --strict ${dir}`);
    run(`attw ${dir}`, `npx attw --pack ${dir} --profile esm-only`);
  }

  const require = createRequire(import.meta.url);
  for (const dir of packages) {
    const dist = join(root, dir, 'dist');
    for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
      // A bin runs when it is loaded: it is run as a program below instead.
      if (file === 'cli.js') {
        const label = `${dir}/dist/cli.js --version (as a program)`;
        const result = spawnSync(process.execPath, [join(dist, file), '--version'], { encoding: 'utf8' });
        console.log(`\n> ${label}: ${result.status === 0 ? result.stdout.trim() : `exit ${result.status}\n${result.stderr}`}`);
        if (result.status !== 0) failures.push(label);
        continue;
      }
      const label = `require(esm) ${dir}/dist/${file}`;
      try {
        require(join(dist, file));
        console.log(`\n> ${label}: ok`);
      } catch (error) {
        console.error(`\n> ${label}: ${error.code ?? ''} ${error.message}`);
        failures.push(label);
      }
    }
  }

  for (const dir of packages) {
    const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: join(root, dir), encoding: 'utf8', shell: true });
    const packed = pack.status === 0 ? JSON.parse(pack.stdout)[0].files.map((f) => f.path) : [];
    const expected = dir === 'packages/docvane' ? ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'docs/cli-json.md', 'docs/cli-json/common.schema.json', 'docs/syntax.md', 'docs/errors.md', 'docs/migrating-from-docxtemplater.md', 'skills/docvane/SKILL.md', 'llms-full.txt', 'README.md', 'LICENSE', 'package.json'] : ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE', 'package.json'];
    for (const required of expected) {
      const label = `${dir} tarball contains ${required}`;
      console.log(`\n> ${label}: ${packed.includes(required) ? 'ok' : 'missing'}`);
      if (!packed.includes(required)) failures.push(label);
    }
  }

  const cli = join(root, 'packages/docvane/dist/cli.js');
  const work = mkdtempSync(join(tmpdir(), 'docvane-bin-'));
  for (const name of ['offer.docx', 'data.json', 'logo.png']) copyFileSync(join(root, 'examples/offer', name), join(work, name));
  for (const args of [['--version'], ['inspect', 'offer.docx', '--json'], ['render', 'offer.docx', 'data.json'], ['preview', 'offer-filled.docx']]) {
    const label = `docvane ${args.join(' ')} (built bin)`;
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: work, encoding: 'utf8' });
    console.log(`\n> ${label}: ${result.status === 0 ? 'ok' : `exit ${result.status}\n${result.stderr}`}`);
    if (result.status !== 0) failures.push(label);
  }
  rmSync(work, { recursive: true, force: true });

  const INTERNAL_PATH = /docs\/(?:PLAN|decisions|CHANGELOG-dev)\.md|docs\/facts\//;
  const INTERNAL_ID = /\b[DF]-[0-9A-Z]{1,4}(?:-[0-9]{1,3})?\b/;
  for (const dir of packages) {
    const dist = join(root, dir, 'dist');
    for (const file of readdirSync(dist)) {
      const text = readFileSync(join(dist, file), 'utf8');
      const path = INTERNAL_PATH.exec(text);
      const id = file.endsWith('.d.ts') ? INTERNAL_ID.exec(text) : null;
      const found = path ?? id;
      const label = `${dir}/dist/${file} names no internal document`;
      console.log(`\n> ${label}: ${found === null ? 'ok' : `found "${found[0]}"`}`);
      if (found !== null) failures.push(label);
    }
  }
}

if (failures.length > 0) {
  console.error(`\ncheck:pkg failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\ncheck:pkg passed');
