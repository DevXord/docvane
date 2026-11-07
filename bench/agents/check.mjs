// Checks the files an agent wrote for a task of tasks.json. Documents are read as text with
// docvane's preview, which reads any DOCX, PPTX or XLSX whatever library wrote it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The problems of a task's output in `dir`; an empty list when every check passes.
 * `preview` is docvane's preview function (passed in, so that tests use the sources).
 */
export function checkTask(task, dir, preview) {
  const problems = [];
  for (const check of task.checks) {
    const path = join(dir, check.file);
    if (!existsSync(path)) {
      problems.push(`${check.file}: missing`);
      continue;
    }
    let text;
    try {
      if (check.kind === 'document') text = preview(new Uint8Array(readFileSync(path))).text;
      else text = readFileSync(path, 'utf8');
      if (check.kind === 'json') JSON.parse(text);
    } catch (error) {
      problems.push(`${check.file}: cannot be read (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    for (const s of check.contains ?? []) if (!text.includes(s)) problems.push(`${check.file}: does not contain ${JSON.stringify(s)}`);
    for (const s of check.notContains ?? []) if (text.includes(s)) problems.push(`${check.file}: contains ${JSON.stringify(s)}`);
    if (check.parts !== undefined) {
      const names = text.split('\n').filter((l) => l.startsWith('== ')).map((l) => l.slice(3));
      const count = names.filter((n) => n.startsWith(check.parts.prefix) && (check.parts.notes || !n.endsWith(' notes'))).length;
      if (count !== check.parts.count) problems.push(`${check.file}: ${String(count)} parts "${check.parts.prefix}…", expected ${String(check.parts.count)}`);
    }
  }
  return problems;
}
