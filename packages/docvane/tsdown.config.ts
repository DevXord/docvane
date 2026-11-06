import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  // The runtime dependencies are installed next to this package and stay imports.
  deps: { neverBundle: [/^node:/, /^xlvane/, /^fflate/] },
});
