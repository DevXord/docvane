import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  // Dependencies stay imports: tplvane and the MCP SDK are installed next to this package.
  deps: { neverBundle: [/^node:/, /^tplvane/, /^@modelcontextprotocol\//] },
});
