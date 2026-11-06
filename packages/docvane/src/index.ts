/**
 * The version of the `docvane` package.
 *
 * @example
 * ```ts
 * import { VERSION } from 'docvane';
 * console.log(VERSION);
 * ```
 */
export const VERSION: string = '0.0.0';

export { inspect, type InspectOptions } from './inspect';
export { render, renderAsync, type RenderOptions, type RenderAsyncOptions } from './render';
export { validate, templateSchema, type ValidateOptions, type ValidateResult, type TemplateSchema } from './validate';
export {
  DvError,
  isDvError,
  ERROR_CODES,
  WARNING_CODES,
  type DvErrorCode,
  type DvWarningCode,
  type DvErrorInit,
  type DvErrorJSON,
  type DvLocation,
  type DvContainer,
  type DvStory,
  type DvDetails,
  type DvDetailValue,
  type DvWarning,
} from './errors';
export { DEFAULT_LIMITS, type Limits, type ReadLimits, type TemplateLimits } from './limits';
export type {
  TagKind,
  TagInfo,
  FormatterArg,
  FormatterCall,
  SectionKind,
  SectionNode,
  JsonSchema,
  JsonSchemaType,
  InspectResult,
  TemplateFormat,
} from './model';
