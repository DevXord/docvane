// Public types of templates: tags, sections and the JSON Schema that `inspect` returns.
import type { DvLocation, DvWarning } from './errors';

/**
 * What a tag does, from its first character: `{name}` value, `{#name}` section, `{^name}`
 * inverted section, `{/name}` end of a section, `{%name}` image, `{~name}` Markdown.
 *
 * @example
 * ```ts
 * import type { TagKind } from 'docvane';
 * const kind: TagKind = 'section';
 * console.log(kind);
 * ```
 */
export type TagKind = 'value' | 'section' | 'inverted' | 'close' | 'image' | 'markdown';

/**
 * A literal argument of a formatter: a string, a number, `true`, `false` or `null`.
 *
 * @example
 * ```ts
 * import type { FormatterArg } from 'docvane';
 * const args: FormatterArg[] = ['PLN', 2, true, null];
 * console.log(args.length);
 * ```
 */
export type FormatterArg = string | number | boolean | null;

/**
 * A formatter applied to a value, such as `currency("PLN")` in `{total | currency("PLN")}`.
 *
 * @example
 * ```ts
 * import type { FormatterCall } from 'docvane';
 * const call: FormatterCall = { name: 'currency', args: ['PLN'] };
 * console.log(call.name);
 * ```
 */
export interface FormatterCall {
  readonly name: string;
  readonly args: readonly FormatterArg[];
}

/**
 * One tag found in the template.
 *
 * @example
 * ```ts
 * import { inspect, type TagInfo } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const tags: readonly TagInfo[] = inspect(bytes).tags;
 * for (const tag of tags) console.log(tag.raw, tag.location.description);
 * ```
 */
export interface TagInfo {
  readonly kind: TagKind;
  /** The tag as written in the document, braces included. */
  readonly raw: string;
  /**
   * The data path, such as `customer.name` (`.` is the current item of a loop), or for an
   * expression its canonical text, such as `total > 100`. A closing tag matches its section by it.
   */
  readonly path: string;
  /** Every data path the tag reads, in order of first use. */
  readonly paths: readonly string[];
  /** The formatters after `|`, in order. */
  readonly formatters: readonly FormatterCall[];
  /** Where the tag starts. */
  readonly location: DvLocation;
}

/**
 * How `inspect` reads a section: `loop` when tags are used inside it, `condition` when none
 * are, `inverted` for `{^name}`. The syntax is the same for loops and conditions; the template
 * engine decides from the data.
 *
 * @example
 * ```ts
 * import type { SectionKind } from 'docvane';
 * const kind: SectionKind = 'loop';
 * console.log(kind);
 * ```
 */
export type SectionKind = 'loop' | 'condition' | 'inverted';

/**
 * A section: the tags from `{#name}` or `{^name}` to `{/name}`, with what is inside.
 *
 * @example
 * ```ts
 * import { inspect, type SectionNode } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const print = (node: SectionNode, depth = 0): void => {
 *   console.log(`${' '.repeat(depth * 2)}${node.kind} ${node.path}`);
 *   for (const inner of node.sections) print(inner, depth + 1);
 * };
 * for (const node of inspect(bytes).sections) print(node);
 * ```
 */
export interface SectionNode {
  readonly kind: SectionKind;
  readonly path: string;
  readonly formatters: readonly FormatterCall[];
  /** The opening tag. */
  readonly open: TagInfo;
  /** The closing tag. */
  readonly close: TagInfo;
  /** Value, image and Markdown tags directly inside the section. */
  readonly tags: readonly TagInfo[];
  /** Sections directly inside the section. */
  readonly sections: readonly SectionNode[];
}

/**
 * A JSON type name used in {@link JsonSchema}.
 *
 * @example
 * ```ts
 * import type { JsonSchemaType } from 'docvane';
 * const type: JsonSchemaType = 'array';
 * console.log(type);
 * ```
 */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/**
 * The subset of JSON Schema (draft 2020-12) that `inspect` produces.
 *
 * @example
 * ```ts
 * import { inspect, type JsonSchema } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const schema: JsonSchema = inspect(bytes).schema;
 * console.log(Object.keys(schema.properties ?? {}), schema.required);
 * ```
 */
export interface JsonSchema {
  readonly $schema?: string;
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  readonly description?: string;
  readonly properties?: { readonly [name: string]: JsonSchema };
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
}

/**
 * The file format of a template.
 *
 * @example
 * ```ts
 * import type { TemplateFormat } from 'docvane';
 * const format: TemplateFormat = 'pptx';
 * console.log(format);
 * ```
 */
export type TemplateFormat = 'docx' | 'pptx' | 'xlsx';

/**
 * What `inspect` found in a template.
 *
 * @example
 * ```ts
 * import { inspect, type InspectResult } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const result: InspectResult = inspect(bytes);
 * console.log(result.format, result.tags.length, JSON.stringify(result.schema));
 * ```
 */
export interface InspectResult {
  readonly format: TemplateFormat;
  /** Every tag, closing tags included, in document order: the main body, then headers, footers, footnotes and endnotes. */
  readonly tags: readonly TagInfo[];
  /** The outermost sections, each with the sections inside it. */
  readonly sections: readonly SectionNode[];
  /** JSON Schema of the data the template needs. */
  readonly schema: JsonSchema;
  /** Things worth knowing that do not stop `inspect`. */
  readonly warnings: readonly DvWarning[];
}
