// `npm run check:pkg`: builds every package and checks it the way a consumer sees it.
//
// 1. publint --strict (warnings count as errors)
// 2. attw --pack <dir> --profile esm-only (types resolve for ESM consumers; CJS is not supported)
// 3. Every file in dist loads with require(): Node.js throws ERR_REQUIRE_ASYNC_MODULE for a
//    module graph with top-level await, which CLAUDE.md forbids.
// 4. Every tarball contains the built entry point, the README and the license.
// 5. No built file names an internal document (CLAUDE.md, "Internal documents"), and the shipped
//    declarations, whose TSDoc readers see, cite no internal decision or fact identifiers.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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
    for (const required of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE', 'package.json']) {
      const label = `${dir} tarball contains ${required}`;
      console.log(`\n> ${label}: ${packed.includes(required) ? 'ok' : 'missing'}`);
      if (!packed.includes(required)) failures.push(label);
    }
  }

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
