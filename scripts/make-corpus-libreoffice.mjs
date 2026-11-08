// Regenerates tests/corpus/libreoffice/*.docx, *.pptx and *.xlsx from the flat ODF sources (.fodt,
// .fodp, .fods) in tests/corpus/libreoffice/src, by saving each one with LibreOffice in headless mode.
// The saved files are committed, so tests do not need LibreOffice; run this only to change them:
//
//   node scripts/make-corpus-libreoffice.mjs [path/to/soffice] [one source file]
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
const profile = mkdtempSync(join(tmpdir(), 'tplvane-lo-'));
try {
  const only = process.argv[3];
  const targets = { '.fodt': ['.docx', 'docx:MS Word 2007 XML'], '.fodp': ['.pptx', 'pptx:Impress Office Open XML'], '.fods': ['.xlsx', 'xlsx:Calc Office Open XML'] };
  for (const file of readdirSync(sources).filter((f) => f.slice(-5) in targets && (only === undefined || f === only))) {
    const [extension, filter] = targets[file.slice(-5)];
    const result = spawnSync(soffice, [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', filter, '--outdir', profile, join(sources, file)], { encoding: 'utf8' });
    const docx = file.slice(0, -5) + extension;
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
