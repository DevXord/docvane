/**
 * The version of the `@docvane/mcp` package.
 *
 * @example
 * ```ts
 * import { VERSION } from '@docvane/mcp';
 * console.log(VERSION);
 * ```
 */
export const VERSION: string = '0.0.0';

export { createTools, type Tool, type ToolResult, type ToolOptions } from './tools';
export { Sandbox, type SandboxOptions } from './sandbox';
