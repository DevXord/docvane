// Regenerates tests/corpus/libreoffice/*.docx from the flat ODF sources in
// tests/corpus/libreoffice/src, by saving each one as DOCX with LibreOffice in headless mode.
// The DOCX files are committed, so tests do not need LibreOffice; run this only to change them:
//
//   node scripts/make-corpus-libreoffice.mjs [path/to/soffice]
//
// LibreOffice writes the current time into docProps/core.xml, so the bytes differ on every run
// even when nothing else changed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const corpus = join(root, 'tests', 'corpus', 'libreoffice');
const sources = join(corpus, 'src');
const soffice = process.argv[2] ?? 'soffice';

const version = spawnSync(soffice, ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error(`Cannot run "${soffice}". Install LibreOffice or pass the path to soffice.`);
  process.exit(1);
}
console.log(version.stdout.trim());

// A separate profile, so that the user's LibreOffice settings and open windows do not interfere.
const profile = mkdtempSync(join(tmpdir(), 'docvane-lo-'));
try {
  for (const file of readdirSync(sources).filter((f) => f.endsWith('.fodt'))) {
    const result = spawnSync(
      soffice,
      [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', profile, join(sources, file)],
      { encoding: 'utf8' },
    );
    const docx = file.replace(/\.fodt$/, '.docx');
    if (result.status !== 0) {
      console.error(`${file}: LibreOffice failed\n${result.stderr}`);
      process.exitCode = 1;
      continue;
    }
    renameSync(join(profile, docx), join(corpus, docx));
    console.log(`${file} -> tests/corpus/libreoffice/${docx}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
