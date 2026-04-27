import { dts } from 'bun-plugin-dtsx'

// Library bundle.
await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: './dist',
  target: 'bun',
  plugins: [dts()],
})

// CLI bundle (kept separate so it lands at dist/cli.js, matching the bin entry).
await Bun.build({
  entrypoints: ['bin/cli.ts'],
  outdir: './dist',
  target: 'bun',
})
