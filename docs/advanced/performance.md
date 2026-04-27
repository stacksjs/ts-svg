# Performance

ts-svg is pure TypeScript; it doesn't hand off to a native rasterizer. That makes it easier to ship and easier to debug, but it also means the obvious hot paths matter. This page is a checklist for getting the most out of it.

## Hoist the parse

`parseSVG` is the slowest stage for small documents — typically 5–10× the cost of `rasterize` for icon-sized SVGs. If you're rendering the same SVG more than once, parse once and rasterise many times:

```ts
import { parseSVG, rasterize, encodePng } from 'ts-svg'

const root = parseSVG(svg) // once

for (const size of [128, 256, 512, 1024]) {
  const fb = rasterize(root, { width: size })
  await Bun.write(`out-${size}.png`, encodePng(fb))
}
```

The `Resvg` shim does this automatically — its constructor caches the parse and `render()` reuses it.

## Tune the tolerance

Bezier flattening is O(curve-detail) — every halving of the tolerance roughly doubles the polygon vertex count. For tiny rendered sizes (icons at 16–32 px), the default `0.25` is overkill:

```ts
rasterize(root, { width: 16, tolerance: 0.5 })  // visibly identical, faster
```

For large rendered sizes (`scale: 4`+), the default isn't smooth enough — drop it:

```ts
rasterize(root, { width: 4096, tolerance: 0.1 })
```

The right value is "as coarse as you can go before edges visibly faceted". Eyeball it once for your asset class and bake it into [`svg.config.ts`](/config).

## Reuse framebuffers

`Resvg#renderInto(fb)` writes into a buffer you allocate and own. For animation loops or batch pipelines that produce many frames at the same size, this removes the steady-state allocation:

```ts
import { Resvg, createFramebuffer, TRANSPARENT } from 'ts-svg'

const resvg = new Resvg(svg)
const fb = createFramebuffer(W, H, TRANSPARENT)

for (const frame of frames) {
  mutate(resvg) // mutate the cached parse
  resvg.renderInto(fb)
  encode(fb)
}
```

See [Buffer reuse](/advanced/buffer-reuse) for the full pattern.

## Avoid per-frame mutation when you can

If the only thing changing between frames is a transform, a fill colour, or a single attribute, mutating the parsed tree in place is much cheaper than re-parsing. Walk the tree once before your loop and grab references to the nodes you'll edit:

```ts
const root = parseSVG(svg)
const handle = root.defs.byId.get('cursor') as SVGGroup

for (const frame of frames) {
  handle.transform = parseTransform(`translate(${frame.x}, ${frame.y})`)
  resvg.renderInto(fb)
}
```

`parseTransform` is cheap; re-parsing the whole SVG is not.

## Fewer, bigger framebuffers

Allocating a `Uint8Array(W * H * 4)` is the largest allocation in the pipeline. For a 4K render that's 64 MiB — V8 / Bun's GC handles it fine, but you don't want to do it repeatedly in a tight loop.

If you can afford the memory, pre-allocate one buffer per concurrent worker rather than one per render. If you're on the edge of memory, render at lower scale and upscale in a downstream encoder that can stream tiles.

## Keep `<use>` shallow when possible

`<use>` recursion expands at render time — every instantiation walks the source tree. A `<use>` of a single shape is essentially free; a `<use>` of a `<g>` containing 200 shapes copies all 200 vertex sets.

If you're generating SVGs programmatically and rendering them once, prefer inlining over `<use>`. If you're rendering many times and *mutating* the source between renders, `<use>` is the right call — you mutate one shape, every instance updates.

## Profile

Bun's built-in profiler works great for ts-svg pipelines:

```bash
bun --inspect-brk script.ts
# open chrome://inspect in Chromium, profile a render
```

Hot paths you'll typically see:

| Function | When it dominates |
| --- | --- |
| `parsePath` / `flattenCommands` | SVGs with lots of complex paths, low tolerance, or many `<use>` instances. |
| `fillPolygons` | Large render dimensions, many overlapping shapes, complex clip-paths. |
| `encodePng` | Very large outputs (4K+) — PNG zlib compression isn't free. |

If `fillPolygons` is the bottleneck, raise tolerance. If `encodePng` is, encode at a lower scale or hand the framebuffer to a faster encoder downstream.

## Concurrency

The library is pure-functional from the caller's perspective — `parseSVG` and `rasterize` don't share state across calls. Run them in parallel with `Worker`, `Promise.all`, or any pattern that fits your runtime:

```ts
const png = await Promise.all(
  svgs.map(svg => Promise.resolve(svgToPng(svg))),
)
```

`svgToPng` is synchronous; the `Promise.all` shape just lets the event loop interleave with other work. For real parallelism, fan out to `Worker`.

## When ts-svg isn't fast enough

For batch pipelines that need to render thousands of large SVGs per second, a native rasterizer (`@resvg/resvg-js`, Skia, Cairo) will outperform any pure-JS implementation by a wide margin — that's the trade-off ts-svg deliberately makes. If you've optimised everything above and you still need more throughput, the native option is the right tool.

For most workloads — icons, charts, UI screenshots, watermarks, server-side card generation — ts-svg is plenty fast and removes the deployment headache of native bindings.
