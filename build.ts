import { dts } from 'bun-plugin-dtsx'

/**
 * One build for both entries, so they share a graph.
 *
 * The CLI imports the library, so built separately each carried its own copy
 * of it — `dist/index.js` and `dist/cli.js` were largely the same bytes twice.
 * `naming` keeps them at the paths the export map and the `bin` entry already
 * point at; only the shared half moves into chunks.
 */
const result = await Bun.build({
  entrypoints: ['src/index.ts', 'bin/cli.ts'],
  outdir: './dist',
  naming: '[name].js',
  splitting: true,
  target: 'bun',
  minify: true,
  plugins: [dts()],
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
