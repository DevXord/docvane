// The skill shipped in the package follows the Agent Skills specification (agentskills.io/specification,
// read 2026-11-07, and its reference validator skills-ref): the fields it allows, the rules for the name,
// and the lengths of the description and of compatibility.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'tplvane';
const text = readFileSync(`packages/tplvane/skills/${dir}/SKILL.md`, 'utf8');

/** Reads the frontmatter, which in this file has one `key: value` per line. */
function frontmatter(source: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  expect(match, 'SKILL.md starts with YAML frontmatter').not.toBeNull();
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const at = line.indexOf(': ');
    expect(at, `a "key: value" line: ${line}`).toBeGreaterThan(0);
    const key = line.slice(0, at);
    const value = line.slice(at + 2);
    // Plain YAML scalars: nothing that YAML would read as a comment, a mapping or a quoted value.
    expect(value, key).not.toMatch(/: | #|^["'&*!|>%@`[{]/);
    fields[key] = value;
  }
  return fields;
}

describe('the tplvane skill', () => {
  const fields = frontmatter(text);

  it('has only the fields of the specification, with name and description', () => {
    for (const key of Object.keys(fields)) expect(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']).toContain(key);
    expect(fields['name']).toBeDefined();
    expect(fields['description']).toBeDefined();
  });

  it('has a name of lowercase letters, digits and single hyphens that matches its folder', () => {
    const name = fields['name'] ?? '';
    expect(name.length).toBeGreaterThanOrEqual(1);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name).toBe(dir);
  });

  it('keeps the description and compatibility within their lengths, and the file under 500 lines', () => {
    expect((fields['description'] ?? '').length).toBeLessThanOrEqual(1024);
    if (fields['compatibility'] !== undefined) expect(fields['compatibility'].length).toBeLessThanOrEqual(500);
    expect(text.split('\n').length).toBeLessThan(500);
  });
});
