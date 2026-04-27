import { dts } from 'bun-plugin-dtsx'

await Promise.all([
  // Library bundle (with .d.ts emit).
  Bun.build({
    entrypoints: ['src/index.ts'],
    outdir: './dist',
    target: 'bun',
    minify: true,
    plugins: [dts()],
  }),
  // CLI bundle (kept separate so it lands at dist/cli.js, matching the bin entry).
  Bun.build({
    entrypoints: ['bin/cli.ts'],
    outdir: './dist',
    target: 'bun',
    minify: true,
  }),
])
