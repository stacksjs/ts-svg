# Custom pipeline

The high-level API (`svgToPng`, `Resvg`) is built on top of three exported primitives:

```
parseSVG → rasterize → encodePng
```

If you need to fit ts-svg into something else — a different encoder, a bespoke compositor, a non-SVG geometry source — you compose those three pieces directly. This page is a tour of the seams.

## Parse, then walk

`parseSVG` returns a typed tree. You can do anything with it before passing it to `rasterize`:

```ts
import { parseSVG, type SVGNode } from 'ts-svg'

const root = parseSVG(svg)

// Strip every <text> regardless of font availability
function strip(node: SVGNode): void {
  if ('children' in node) {
    node.children = node.children.filter(c => c.tag !== 'text')
    node.children.forEach(strip)
  }
}
strip(root)
```

Mutating the tree is fine. `rasterize` doesn't keep a reference; subsequent calls see the new state.

## Rasterise to your own buffer

`rasterize` returns a `Framebuffer { width, height, data: Uint8Array }`. You can hand it straight to `encodePng`, or treat it as a generic RGBA buffer:

```ts
import { rasterize, encodePng } from 'ts-svg'

const fb = rasterize(root, { width: 800 })

// Hand to a different encoder (sharp, ts-png, jimp, …)
import sharp from 'sharp'
await sharp(fb.data, { raw: { width: fb.width, height: fb.height, channels: 4 } })
  .webp({ quality: 90 })
  .toFile('out.webp')
```

`Uint8Array` is the lingua franca; every Node / Bun image library accepts it.

## Composite SVG over a bitmap

ts-svg doesn't currently composite into an existing buffer (`renderInto` always overwrites — see [Buffer reuse](/advanced/buffer-reuse)). Build the composite yourself by rasterising the SVG separately and alpha-blending the two buffers:

```ts
import { Resvg, createFramebuffer, encodePng, TRANSPARENT } from 'ts-svg'

const bg = createFramebuffer(800, 600, TRANSPARENT)
bg.data.set(decodeJpeg('photo.jpg'))

const overlay = new Resvg(svgOverlay).render() // RenderedImage
const overlayPx = overlay.pixels()              // RGBA Uint8Array

// straight-alpha source-over composite
for (let i = 0; i < bg.data.length; i += 4) {
  const sa = overlayPx[i + 3] / 255
  const da = bg.data[i + 3] / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) continue
  for (let c = 0; c < 3; c++) {
    bg.data[i + c] = (overlayPx[i + c] * sa + bg.data[i + c] * da * (1 - sa)) / oa
  }
  bg.data[i + 3] = oa * 255
}

await Bun.write('badged.png', encodePng(bg))
```

This is the right shape for watermarks, sprite sheets, and dynamic OG card images. If you do this often, lift the blend loop into a helper.

## Skip the parse — feed your own geometry

If your geometry doesn't come from SVG (e.g. you're rendering a chart from data), the lower-level helpers are exposed:

```ts
import {
  createFramebuffer, fillPolygons, strokePolylines,
  TRANSPARENT, BLACK,
} from 'ts-svg'

const fb = createFramebuffer(400, 300, TRANSPARENT)

const polygon = [{
  points: [[10, 10], [200, 10], [200, 100], [10, 100]],
  closed: true,
}]
fillPolygons(fb, polygon, { r: 14, g: 165, b: 233, a: 255 })

const polyline = [[[20, 50], [180, 50]]]
strokePolylines(fb, polyline, BLACK, {
  width: 2,
  cap: 'round', join: 'round', miterLimit: 4,
  dashArray: [], dashOffset: 0,
})

await Bun.write('chart.png', encodePng(fb))
```

This is exactly what `rasterize` does internally — for every shape in the tree, it derives polygons, hands them to `fillPolygons` and `strokePolylines`. You can build your own renderer on top by skipping the SVG parse.

## Decode → re-encode (transcode SVG)

```ts
import { parseSVG, rasterize, encodePng } from 'ts-svg'

const fb = rasterize(parseSVG(svg))

// PNG out
const png = encodePng(fb)

// Or skip ts-svg's encoder and use someone else's
import sharp from 'sharp'
const webp = await sharp(fb.data, { raw: { width: fb.width, height: fb.height, channels: 4 } })
  .webp().toBuffer()
```

ts-svg's PNG encoder is fine for everyday output. Native encoders win for very large images or non-PNG formats.

## Path-only pipelines

```ts
import { parsePath, flattenCommands } from 'ts-svg'

// Take an SVG path string and turn it into a polyline you can plot
const cmds = parsePath('M 10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80')
const contours = flattenCommands(cmds, /* tolerance */ 0.25)
const polyline = contours[0].points
// → Array<[number, number]> with one vertex per flattened segment
```

Useful when the destination isn't a raster at all — CNC, plotting, GIS export.

## Colour-only pipelines

```ts
import { parseColor, BLACK } from 'ts-svg'

parseColor('#0ea5e9')              // → { r: 14, g: 165, b: 233, a: 255 }
parseColor('rgba(0, 0, 0, 0.5)')   // → { r: 0,   g: 0,   b: 0,   a: 128 }
parseColor('currentColor', BLACK)  // → BLACK
```

`parseColor` accepts every CSS-2-and-some-CSS-3 colour syntax. Use it as a standalone utility — no SVG required.

## Don't reinvent what's already exposed

Before composing your own pipeline, check the [API reference](/api) — most of the building blocks you'd think of writing already exist as named exports. The renderer's internal helpers are deliberately public so you can hot-swap pieces rather than fork the library.
