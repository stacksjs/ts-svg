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
}

cli
  .command('render <input>', 'Rasterise an SVG file to PNG')
  .option('-o, --out <file>', 'Output PNG path (default: <input>.png)')
  .option('-s, --scale <factor>', 'Multiply intrinsic dimensions', { default: 1 })
  .option('-w, --width <px>', 'Output width in pixels (overrides scale)')
  .option('-h, --height <px>', 'Output height in pixels (overrides scale)')
  .option('-b, --background <color>', 'Background colour (e.g. "#fff" or "transparent")')
  .option('-t, --tolerance <px>', 'Bezier flattening tolerance', { default: 0.25 })
  .example('ts-svg render logo.svg -o logo.png --scale 2')
  .action((input: string, options: RenderOpts) => {
    const inPath = resolve(input)
    const outPath = options.out
      ? resolve(options.out)
      : resolve(inPath.replace(new RegExp(`${extname(inPath)}$`), '.png'))

    const svg = readFileSync(inPath, 'utf8')
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
    console.log(`wrote ${outPath} (${png.byteLength} bytes)`)
  })

cli
  .command('to-png <input>', 'Convenience: parse + render + write in one shot')
  .option('-o, --out <file>', 'Output PNG path')
  .option('-s, --scale <factor>', 'Multiply intrinsic dimensions', { default: 1 })
  .action((input: string, options: { out?: string, scale?: number }) => {
    const inPath = resolve(input)
    const outPath = options.out
      ? resolve(options.out)
      : resolve(inPath.replace(new RegExp(`${extname(inPath)}$`), '.png'))
    const svg = readFileSync(inPath, 'utf8')
    const png = svgToPng(svg, { scale: Number(options.scale ?? 1) })
    writeFileSync(outPath, png)
    console.log(`wrote ${outPath} (${png.byteLength} bytes)`)
  })

cli.command('version', 'Show CLI version').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse(process.argv)
