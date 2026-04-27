# Usage

`ts-svg` exposes three layers, library-first and CLI-second. Start with whichever matches your call site; mix as needed.

## Library: one-shot

`svgToPng` is the shortest path. Everything else in the library is built on top of it.

```ts
import { svgToPng } from 'ts-svg'
import { writeFileSync } from 'node:fs'

const svg = await Bun.file('logo.svg').text()
writeFileSync('logo.png', svgToPng(svg, { scale: 2 }))
```

`svgToPng(svg, opts?)` returns a `Buffer` containing PNG bytes. Pass any [`RenderOptions`](/api#renderoptions) (width / height / scale / background / tolerance / etc.).

## Library: element tree

When you need to inspect or mutate the SVG between parse and render, use the three-step pipeline:

```ts
import { parseSVG, rasterize, encodePng } from 'ts-svg'

const root = parseSVG(svg)            // typed SVGRoot — discriminated by `tag`
const fb = rasterize(root, { scale: 2 }) // Framebuffer { width, height, data: Uint8Array }
const png = encodePng(fb)             // Buffer
```

`SVGRoot` exposes `children: SVGNode[]` plus a `defs` registry for gradients, clip-paths, and masks. Mutate freely — `rasterize` is pure on the input tree.

```ts
// Recolour every <rect> to white before rendering
import type { SVGNode } from 'ts-svg'

function walk(node: SVGNode): void {
  if (node.tag === 'rect') node.fill = 'white'
  if ('children' in node) node.children.forEach(walk)
}
root.children.forEach(walk)
```

See [Features → Element tree](/features/parser) for the full node taxonomy.

## Library: Resvg shim

If you're migrating from `@resvg/resvg-js`, change one import:

```ts
import { Resvg } from 'ts-svg' // was '@resvg/resvg-js'

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  background: '#fff',
})

const img = resvg.render()
img.width()      // number
img.height()     // number
img.pixels()     // Uint8Array (RGBA, top-to-bottom; copy of the framebuffer)
img.asPng()      // Buffer
```

`fitTo.mode` accepts `'original'`, `'zoom'`, `'width'`, or `'height'`. The constructor parses the SVG once and caches the tree, so calling `render()` again is cheap.

For the migration matrix and the resvg-js options that are accepted but not yet implemented, see [Advanced → Resvg shim](/advanced/resvg-shim).

## Fonts and text

`<text>` elements need a font resolver — without one, text is silently skipped (rendering anything fakish would be worse than rendering nothing). A resolver maps a font request to glyph data:

```ts
import { svgToPng, type FontResolver } from 'ts-svg'

const fontResolver: FontResolver = (familyList, sizeHint) => {
  // return a ResolvedFont, or null to skip this <text>
  return loadFont(familyList, sizeHint)
}

svgToPng(svg, { fontResolver })
```

See [Advanced → Font resolvers](/advanced/font-resolvers) for the full `FontResolver` contract and recipes for shipping bundled fonts.

## CLI

The package installs an `svg` executable. Two commands cover the common cases.

```bash
# Rasterise a file to PNG
svg render logo.svg -o logo.png --scale 2

# Pin output dimensions
svg render logo.svg --width 1024 --background "#fff"

# Read from stdin, write to a path
cat logo.svg | svg render --stdin -o logo.png

# Convenience: parseSVG + rasterize + encodePng
svg to-png logo.svg
```

| Flag | Default | Notes |
| --- | --- | --- |
| `-o, --out <file>` | `<input>.png` | Required when reading from stdin. |
| `-s, --scale <factor>` | `1` | Multiplies the SVG's intrinsic dims. |
| `-w, --width <px>` | — | Overrides scale; aspect-preserved if height omitted. |
| `-h, --height <px>` | — | Overrides scale; aspect-preserved if width omitted. |
| `-b, --background <color>` | transparent | Any CSS colour string. |
| `-t, --tolerance <px>` | `0.25` | Bezier flattening tolerance. |
| `--stdin` | — | Read SVG from stdin (overrides positional input). |

`svg --help` prints the full reference; `svg version` prints the build version.

See [Advanced → CLI](/advanced/cli) for piping recipes and the binary distribution model.

## Reusing buffers

For animation loops or per-frame thumbnails, `Resvg#renderInto(fb)` lets you rasterise into a pre-allocated framebuffer instead of reallocating an RGBA buffer per call:

```ts
import { Resvg, createFramebuffer, TRANSPARENT } from 'ts-svg'

const resvg = new Resvg(svg)
const fb = createFramebuffer(512, 512, TRANSPARENT)

for (let i = 0; i < 60; i++) {
  resvg.renderInto(fb)
  // fb.data is a Uint8Array you can blit / encode / hash
}
```

See [Advanced → Buffer reuse](/advanced/buffer-reuse) for the full lifecycle.

## Next

- [API reference](/api) — every export with its signature and types.
- [Configuration](/config) — `svg.config.ts` defaults.
- [Features](/features/parser) — capability deep dives.
- [Advanced](/advanced/resvg-shim) — performance, resolvers, custom pipelines.
