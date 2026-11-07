// Copies the documentation of the repository into the docvane package before it is built, so that
// it can be read without network access after installing (node_modules/docvane/docs), and writes
// llms-full.txt with all of it in one file. The copies are not committed (.gitignore).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = join(root, 'packages', 'docvane');
const DOCS = ['syntax.md', 'errors.md', 'migrating-from-docxtemplater.md'];

mkdirSync(join(pkg, 'docs'), { recursive: true });
for (const name of DOCS) writeFileSync(join(pkg, 'docs', name), readFileSync(join(root, 'docs', name)));

const parts = [
  ['README.md', join(pkg, 'README.md')],
  ['skills/docvane/SKILL.md', join(pkg, 'skills', 'docvane', 'SKILL.md')],
  ...DOCS.map((name) => [`docs/${name}`, join(root, 'docs', name)]),
  ['docs/cli-json.md', join(pkg, 'docs', 'cli-json.md')],
];
const text = parts.map(([name, path]) => `<!-- ${name} -->\n\n${readFileSync(path, 'utf8').trim()}\n`).join('\n');
writeFileSync(join(pkg, 'llms-full.txt'), `# docvane: all documentation in one file\n\nThe README, the Agent Skill and the documents of node_modules/docvane/docs, in this order.\n\n${text}`);
