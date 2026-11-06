import { defineConfig } from 'tsdown';

// One build for the library and the command line (bin), so that they share their code. The library
// imports no Node.js module; only src/cli does (tests/policy/packages.test.ts).
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/bin.ts' },
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  // The runtime dependencies are installed next to this package and stay imports.
  deps: { neverBundle: [/^node:/, /^xlvane/, /^fflate/] },
});
