import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  // xlvane is installed next to this package and stays an import.
  deps: { neverBundle: [/^node:/, /^xlvane/] },
});
