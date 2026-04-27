#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import process from 'node:process'
import { CLI } from '@stacksjs/clapp'
import { version } from '../package.json'
import { Resvg, svgToPng } from '../src'

const cli = new CLI('ts-svg')

interface RenderOpts {
  out?: string
  scale?: number
  width?: number
  height?: number
  background?: string
  tolerance?: number
  stdin?: boolean
}

function readSvg(input: string | undefined, useStdin: boolean | undefined): { svg: string, source: string } {
  if (useStdin || input === '-' || input == null) {
    // Read from stdin synchronously.
    const buf = readFileSync(0)
    const svg = buf.toString('utf8')
    if (!svg.trim()) {
      console.error('ts-svg: stdin was empty (pipe an SVG document to render)')
      process.exit(2)
    }
    return { svg, source: '<stdin>' }
  }
  try {
    return { svg: readFileSync(resolve(input), 'utf8'), source: resolve(input) }
  }
  catch (err) {
    console.error(`ts-svg: cannot read ${input}: ${(err as Error).message}`)
    process.exit(2)
  }
}

function deriveOut(input: string | undefined, override: string | undefined, useStdin: boolean | undefined): string {
  if (override) return resolve(override)
  if (useStdin || input == null || input === '-') {
    console.error('ts-svg: --out is required when reading from stdin')
    process.exit(2)
  }
  const inPath = resolve(input)
  return resolve(inPath.replace(new RegExp(`${extname(inPath)}$`), '.png'))
}

cli
  .command('render [input]', 'Rasterise an SVG file (or stdin) to PNG')
  .option('-o, --out <file>', 'Output PNG path (default: <input>.png)')
  .option('-s, --scale <factor>', 'Multiply intrinsic dimensions', { default: 1 })
  .option('-w, --width <px>', 'Output width in pixels (overrides scale)')
  .option('-h, --height <px>', 'Output height in pixels (overrides scale)')
  .option('-b, --background <color>', 'Background colour (e.g. "#fff" or "transparent")')
  .option('-t, --tolerance <px>', 'Bezier flattening tolerance', { default: 0.25 })
  .option('--stdin', 'Read SVG from stdin (overrides positional input)')
  .example('ts-svg render logo.svg -o logo.png --scale 2')
  .example('cat logo.svg | ts-svg render --stdin -o logo.png')
  .action((input: string | undefined, options: RenderOpts) => {
    const { svg, source } = readSvg(input, options.stdin)
    const outPath = deriveOut(input, options.out, options.stdin)
    try {
      const r = new Resvg(svg, {
        fitTo: options.width != null
          ? { mode: 'width', value: Number(options.width) }
          : options.height != null
            ? { mode: 'height', value: Number(options.height) }
            : { mode: 'zoom', value: Number(options.scale ?? 1) },
        background: options.background,
        tolerance: options.tolerance != null ? Number(options.tolerance) : undefined,
      })
      const png = r.render().asPng()
      writeFileSync(outPath, png)
      console.log(`wrote ${outPath} (${png.byteLength} bytes from ${source})`)
    }
    catch (err) {
      console.error(`ts-svg: render failed (${source}): ${(err as Error).message}`)
      process.exit(1)
    }
  })

cli
  .command('to-png [input]', 'Convenience: parse + render + write in one shot')
  .option('-o, --out <file>', 'Output PNG path')
  .option('-s, --scale <factor>', 'Multiply intrinsic dimensions', { default: 1 })
  .option('--stdin', 'Read SVG from stdin')
  .action((input: string | undefined, options: { out?: string, scale?: number, stdin?: boolean }) => {
    const { svg, source } = readSvg(input, options.stdin)
    const outPath = deriveOut(input, options.out, options.stdin)
    try {
      const png = svgToPng(svg, { scale: Number(options.scale ?? 1) })
      writeFileSync(outPath, png)
      console.log(`wrote ${outPath} (${png.byteLength} bytes from ${source})`)
    }
    catch (err) {
      console.error(`ts-svg: render failed (${source}): ${(err as Error).message}`)
      process.exit(1)
    }
  })

cli.command('version', 'Show CLI version').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()

// Show help when invoked with no arguments.
if (process.argv.length <= 2) {
  cli.outputHelp?.()
  process.exit(0)
}

cli.parse(process.argv)
