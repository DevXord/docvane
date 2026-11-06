// Templates written in the syntax of the basic tags of docxtemplater (D-056): values, loops,
// inverted sections, conditions, {.}, {/} closing the innermost section, other delimiters set by
// an option or by {=[[ ]]=} in the template. The tags that docvane does not have are reported
// with a hint.
import { describe, expect, it } from 'vitest';
import { inspect, render } from 'docvane';
import { buildDocx, p, table } from '../helpers/docx';
import { bodyText } from '../helpers/read-docx';
import { expectDvError } from '../helpers/expect-error';

const users = [
  { name: 'Anna', roles: ['admin', 'editor'] },
  { name: 'Jan', roles: [] },
];

describe('docxtemplater syntax', () => {
  it('fills values, loops over paragraphs, table rows and inline, conditions and inverted sections', () => {
    const body =
      p('Hello {name}') +
      p('{#users}') +
      p('User {name}: {#roles}{.} {/roles}{^roles}no roles{/roles}') +
      p('{/users}') +
      table([[p('{#users}{name}'), p('{roles.length}{/users}')]]) +
      p('{#isAdmin}Admin view{/isAdmin}{^isAdmin}Guest view{/isAdmin}');
    const out = bodyText(render(buildDocx({ body }), { name: 'Team', users, isAdmin: false }));
    expect(out).toEqual(['Hello Team', 'User Anna: admin editor ', 'User Jan: no roles', 'Anna', '2', 'Jan', '0', 'Guest view']);
  });

  it('closes the innermost section with {/}', () => {
    const body = p('{#users}{name}{#roles}[{.}]{/}, {/}') + p('{#users}') + p('- {name}') + p('{/}');
    expect(bodyText(render(buildDocx({ body }), { users }))).toEqual(['Anna[admin][editor], Jan, ', '- Anna', '- Jan']);
    expect(inspect(buildDocx({ body })).sections.map((s) => [s.kind, s.path, s.close.raw])).toEqual([
      ['loop', 'users', '{/}'],
      ['loop', 'users', '{/}'],
    ]);
  });

  it('reports {/} without an open section', () => {
    const error = expectDvError(() => inspect(buildDocx({ body: p('text {/}') })), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors.map((e) => [e.code, e.message])).toEqual([['DV_E_SECTION_UNOPENED', '"{/}" closes a section that is not open.']]);
  });

  it('takes other delimiters from the delimiters option', () => {
    const body = p('Hello {{name}} {not a tag}') + p('{{#users}}{{name}};{{/users}}');
    const bytes = buildDocx({ body });
    expect(bodyText(render(bytes, { name: 'Team', users }, { delimiters: { start: '{{', end: '}}' } }))).toEqual(['Hello Team {not a tag}', 'Anna;Jan;']);
    expect(inspect(bytes, { delimiters: { start: '{{', end: '}}' } }).tags.map((t) => t.raw)).toEqual(['{{name}}', '{{#users}}', '{{name}}', '{{/users}}']);
    expect(bodyText(render(buildDocx({ body: p('[[name]] and <%name%>') }), { name: 'X' }, { delimiters: { start: '<%', end: '%>' } }))).toEqual(['[[name]] and X']);
  });

  it('changes the delimiters in the template with {=[[ ]]=}, until the end of the part', () => {
    const body = p('{name} {=[[ ]]=}[[name]] {kept}') + p('[[#users]][[name]] [[/users]]') + p('[[=<< >>=]]<<name>>');
    expect(bodyText(render(buildDocx({ body }), { name: 'X', users }))).toEqual(['X X {kept}', 'Anna Jan ', 'X']);
    const result = inspect(buildDocx({ body }));
    expect(result.tags[1]).toMatchObject({ raw: '{=[[ ]]=}', kind: 'value' });
    expect(Object.keys(result.schema.properties ?? {})).toEqual(['name', 'users']);
  });

  it('starts every part with the delimiters of the option: a change in the body does not reach the header', () => {
    const bytes = buildDocx({ body: p('{=[[ ]]=}[[a]]'), headers: [p('{b} [[c]]')] });
    expect(inspect(bytes).tags.map((t) => t.raw)).toEqual(['{=[[ ]]=}', '[[a]]', '{b}']);
  });

  it('reports invalid delimiters, in the template and in the option', () => {
    const error = expectDvError(() => inspect(buildDocx({ body: p('{=[[=}') + p('{= a a =}') })), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors.map((e) => e.code)).toEqual(['DV_E_TAG_SYNTAX', 'DV_E_TAG_SYNTAX']);
    for (const delimiters of [{ start: '', end: '}' }, { start: '[[', end: '[[' }, { start: '{', end: '{{' }, { start: 'a b', end: 'c' }, { start: 1, end: 2 }]) {
      expectDvError(() => inspect(buildDocx({ body: p('x') }), { delimiters } as never), 'DV_E_INVALID_OPTION');
    }
  });

  it('explains the docxtemplater tags that docvane does not have', () => {
    const error = expectDvError(() => inspect(buildDocx({ body: p('{@rawXml}') + p('{-w:p loop}') + p('{/loop}') })), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors.map((e) => [e.code, e.message])).toEqual([
      ['DV_E_TAG_SYNTAX', expect.stringContaining('Raw XML tags such as {@rawXml} are not supported') as unknown as string],
      ['DV_E_TAG_SYNTAX', expect.stringContaining('Loops over a named element such as {-w:p loop} are not supported') as unknown as string],
      ['DV_E_SECTION_UNOPENED', '"{/loop}" closes a section that is not open.'],
    ]);
  });
});
