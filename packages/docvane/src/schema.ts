// Infers the JSON Schema (draft 2020-12) of the data a template needs, from its tags and sections
// (docs/syntax.md, "The data schema"; D-016):
// - A value {a.b} is required, with the type string, number or boolean; the names before the last
//   one are objects.
// - A section with tags inside is a loop: a required array of objects. Names used inside belong
//   to the item, the innermost section first. With {.} inside it is an array of plain values.
// - A section with nothing inside is a condition, and {^name} an inverted section: an optional
//   boolean. Any other use of the same name wins over a condition, because a section tests the
//   value for truth.
// - {%name} is a required image, {~name} a required Markdown string.
// - Uses that do not fit together (a value and a loop, say) give anyOf and DV_W_SCHEMA_CONFLICT.
// - In expressions, operands of comparisons are required values, operands of !, && and || are
//   conditions, and a value before a `default` formatter is optional (D-024). A section over an
//   expression ({#total > 100}) is a condition, and its content is in the same scope.
// Names from the template become keys of the output only through Object.defineProperty, so even a
// name such as "toString" is an own data property; __proto__ and similar are already refused by
// the tag parser.
import type { DvLocation, DvWarning } from './errors';
import type { Expr } from './expr/ast';
import type { JsonSchema, JsonSchemaType, TagInfo } from './model';
import type { TagRecord } from './template/analyze';
import type { SectionTree, TreeChild } from './template/structure';

type Node =
  | { t: 'value' }
  | { t: 'object'; props: Map<string, Prop> }
  | { t: 'array'; items: Node | undefined }
  | { t: 'boolean' }
  | { t: 'image' }
  | { t: 'markdown' }
  | { t: 'conflict'; options: Node[] };

interface Prop {
  node: Node;
  required: boolean;
  /** Where the name is first used (as anything but a condition, if it is), and how often. */
  first: DvLocation;
  role: string;
  uses: number;
}

/** A scope in which names are resolved: the data root, or the item of a loop. */
type Scope = { readonly kind: 'root'; readonly obj: Node & { t: 'object' } } | { readonly kind: 'loop'; readonly array: Node & { t: 'array' }; readonly path: string };

const VALUE_TYPES: readonly JsonSchemaType[] = ['string', 'number', 'boolean'];

class SchemaBuilder {
  readonly root: Node & { t: 'object' } = { t: 'object', props: new Map() };
  readonly warnings: DvWarning[] = [];

  /** Merges `incoming` into `existing`; records a conflict warning at `where` for uses that do not fit. */
  merge(existing: Node, incoming: Node, path: string, where: DvLocation): Node {
    if (existing.t === 'boolean') return incoming;
    if (incoming.t === 'boolean') return existing;
    if (existing.t === 'object' && incoming.t === 'object') {
      for (const [name, prop] of incoming.props) this.mergeProp(existing, name, prop, `${path}.${name}`);
      return existing;
    }
    if (existing.t === 'array' && incoming.t === 'array') {
      if (incoming.items !== undefined) existing.items = existing.items === undefined ? incoming.items : this.merge(existing.items, incoming.items, `${path}[]`, where);
      return existing;
    }
    if (existing.t === incoming.t && existing.t !== 'conflict') return existing;
    if (existing.t === 'conflict') {
      const same = existing.options.findIndex((o) => o.t === incoming.t);
      if (same === -1) existing.options.push(incoming);
      else existing.options[same] = this.merge(existing.options[same] as Node, incoming, path, where);
      return existing;
    }
    this.warnings.push({
      code: 'DV_W_SCHEMA_CONFLICT',
      message: `"${path}" is used in ways that do not fit together: as ${describe(existing)} and as ${describe(incoming)}.`,
      location: where,
      hint: 'Use different names for different data, or use the name the same way everywhere. The schema allows each of the uses (anyOf).',
    });
    return { t: 'conflict', options: [existing, incoming] };
  }

  mergeProp(obj: Node & { t: 'object' }, name: string, prop: Prop, path: string): void {
    const existing = obj.props.get(name);
    if (existing === undefined) {
      obj.props.set(name, prop);
      return;
    }
    if (existing.node.t === 'boolean' && prop.node.t !== 'boolean') {
      existing.first = prop.first;
      existing.role = prop.role;
    }
    existing.node = this.merge(existing.node, prop.node, path, prop.first);
    existing.required ||= prop.required;
    existing.uses += prop.uses;
  }

  /** The object in which names of `scope` are resolved, creating or merging the loop item. */
  objectOf(scope: Scope, where: DvLocation): Node & { t: 'object' } {
    if (scope.kind === 'root') return scope.obj;
    const item = scope.array.items;
    if (item === undefined) {
      const obj: Node & { t: 'object' } = { t: 'object', props: new Map() };
      scope.array.items = obj;
      return obj;
    }
    if (item.t === 'object') return item;
    if (item.t === 'conflict') {
      const existing = item.options.find((o): o is Node & { t: 'object' } => o.t === 'object');
      if (existing !== undefined) return existing;
    }
    const obj: Node & { t: 'object' } = { t: 'object', props: new Map() };
    const merged = this.merge(item, obj, `${scope.path}[]`, where);
    scope.array.items = merged;
    return merged.t === 'object' ? merged : (merged.t === 'conflict' ? (merged.options.find((o) => o === obj) as Node & { t: 'object' }) : obj);
  }

  /** Adds a use of `tag` with schema `leaf` in `scope`; returns the node that now holds it. */
  add(scope: Scope, tag: TagInfo, segments: readonly string[], leaf: Node, required: boolean, role: string): Node {
    if (segments.length === 0) {
      // {.}: the current item itself (outside a loop, the tree builder already reported it).
      if (scope.kind === 'loop') scope.array.items = scope.array.items === undefined ? leaf : this.merge(scope.array.items, leaf, `${scope.path}[]`, tag.location);
      return leaf;
    }
    let obj = this.objectOf(scope, tag.location);
    let path = scope.kind === 'loop' ? `${scope.path}[]` : '';
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i] as string;
      path = path === '' ? name : `${path}.${name}`;
      const last = i === segments.length - 1;
      const node: Node = last ? leaf : { t: 'object', props: new Map() };
      this.mergeProp(obj, name, { node, required, first: tag.location, role: last ? role : '', uses: 1 }, path);
      const held = (obj.props.get(name) as Prop).node;
      if (last) return held;
      if (held.t === 'object') obj = held;
      else if (held.t === 'conflict') obj = held.options.find((o): o is Node & { t: 'object' } => o.t === 'object') ?? obj;
      else return held;
    }
    return leaf;
  }

  /**
   * Adds the paths an expression reads: `required` values (a value tag, an operand of a
   * comparison), `optional` values (before a `default` formatter) and `truth` tests (operands of
   * !, && and ||, and sections over an expression), which are optional conditions.
   */
  addExpr(scope: Scope, tag: TagInfo, e: Expr, mode: 'required' | 'optional' | 'truth'): void {
    switch (e.t) {
      case 'path':
        if (mode === 'truth') this.add(scope, tag, e.segments, { t: 'boolean' }, false, 'Condition');
        else this.add(scope, tag, e.segments, { t: 'value' }, mode === 'required', 'Value');
        return;
      case 'not':
      case 'and':
      case 'or':
        for (const x of e.t === 'not' ? [e.e] : [e.l, e.r]) this.addExpr(scope, tag, x, 'truth');
        return;
      case 'compare':
        this.addExpr(scope, tag, e.l, 'required');
        this.addExpr(scope, tag, e.r, 'required');
        return;
      case 'pipe':
        this.addExpr(scope, tag, e.e, e.formatters.some((f) => f.name === 'default') ? 'optional' : mode === 'truth' ? 'required' : mode);
        return;
      case 'literal':
    }
  }

  /** Adds the tags and sections of `children` in `scope`. */
  addChildren(children: readonly TreeChild[], scope: Scope): void {
    for (const child of children) {
      if ('tag' in child) {
        const { info, parsed } = child.tag;
        if (info.kind === 'image' || info.kind === 'markdown') {
          this.add(scope, info, parsed.segments ?? [], info.kind === 'image' ? { t: 'image' } : { t: 'markdown' }, true, info.kind === 'image' ? 'Image' : 'Markdown text');
        } else {
          this.addExpr(scope, info, fullExpr(child.tag), 'required');
        }
      } else {
        this.addSection(child.section, scope);
      }
    }
  }

  addSection(section: SectionTree, scope: Scope): void {
    const { info, parsed } = section.open;
    const plain = parsed.segments !== null && parsed.formatters.length === 0;
    if (section.kind !== 'loop') {
      if (plain) this.add(scope, info, parsed.segments ?? [], { t: 'boolean' }, false, section.kind === 'inverted' ? 'Shown when false or empty' : 'Condition');
      else this.addExpr(scope, info, fullExpr(section.open), 'truth');
      // The content of a condition is shown in the same scope.
      this.addChildren(section.children, scope);
      return;
    }
    const array: Node & { t: 'array' } = { t: 'array', items: undefined };
    const held = this.add(scope, info, parsed.segments ?? [], array, true, 'Loop');
    const target = held.t === 'array' ? held : held.t === 'conflict' ? (held.options.find((o): o is Node & { t: 'array' } => o.t === 'array') ?? array) : array;
    const path = (scope.kind === 'loop' ? `${scope.path}[].` : '') + info.path;
    this.addChildren(section.children, { kind: 'loop', array: target, path });
  }
}

/** The whole expression of a tag, its formatters included. */
function fullExpr(tag: TagRecord): Expr {
  return tag.parsed.formatters.length === 0 ? tag.parsed.expr : { t: 'pipe', e: tag.parsed.expr, formatters: tag.parsed.formatters };
}

function describe(node: Node): string {
  switch (node.t) {
    case 'value':
      return 'a value';
    case 'object':
      return 'an object with fields';
    case 'array':
      return 'a loop';
    case 'boolean':
      return 'a condition';
    case 'image':
      return 'an image';
    case 'markdown':
      return 'Markdown text';
    case 'conflict':
      return 'several kinds of data';
  }
}

function defineAll<T>(entries: readonly (readonly [string, T])[]): { readonly [name: string]: T } {
  const out: { [name: string]: T } = {};
  for (const [name, value] of entries) Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
  return out;
}

function usedIn(prop: Prop): string {
  const where = prop.first.description ?? prop.first.part ?? 'the template';
  const more = prop.uses > 1 ? ` and ${String(prop.uses - 1)} more ${prop.uses === 2 ? 'place' : 'places'}` : '';
  return `${prop.role === '' ? 'Used' : prop.role} in ${where}${more}.`;
}

function toSchema(node: Node, description?: string): JsonSchema {
  const d = description === undefined ? {} : { description };
  switch (node.t) {
    case 'value':
      return { type: VALUE_TYPES, ...d };
    case 'boolean':
      return { type: 'boolean', ...d };
    case 'image':
      return { ...d };
    case 'markdown':
      return { type: 'string', ...d };
    case 'array':
      return { type: 'array', ...d, items: node.items === undefined ? {} : toSchema(node.items) };
    case 'object': {
      const props = [...node.props];
      const required = props.filter(([, p]) => p.required).map(([name]) => name);
      return {
        type: 'object',
        ...d,
        properties: defineAll(props.map(([name, p]) => [name, toSchema(p.node, p.role === '' ? undefined : usedIn(p))] as const)),
        ...(required.length === 0 ? {} : { required }),
      };
    }
    case 'conflict':
      return { ...d, anyOf: node.options.map((o) => toSchema(o)) };
  }
}

/** The JSON Schema of the data for the given tree (one list of children per part, in order). */
export function inferSchema(parts: readonly (readonly TreeChild[])[]): { schema: JsonSchema; warnings: DvWarning[] } {
  const builder = new SchemaBuilder();
  for (const children of parts) builder.addChildren(children, { kind: 'root', obj: builder.root });
  const body = toSchema(builder.root);
  return { schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...body }, warnings: builder.warnings };
}
