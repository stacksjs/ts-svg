# Rendering

`rasterize(root, opts)` walks an `SVGRoot` and produces a `Framebuffer` (an RGBA `Uint8Array` plus width and height). This page covers what happens between the two — how shapes become pixels.

## Pipeline at a glance

For every shape in the tree:

1. **Style cascade** — fold inherited fill, stroke, opacity, transform, clip-path, mask down from ancestors.
2. **Transform composition** — multiply parent transforms with the element's own to get a single SVG-user-space → device-pixel matrix.
3. **Geometry → contours** — convert the shape (rect, circle, path, …) to closed polygons, flattening curves with [adaptive subdivision](#flattening-tolerance).
4. **Polygon rasterise** — fill with [analytical anti-aliasing](#anti-aliasing); stroke as a polyline expansion.
5. **Compositing** — alpha-blend the result onto the framebuffer.

`<g>` containers don't draw themselves; they just push transform / style / clip-path onto the cascade.

## Output sizing

Three knobs on `RenderOptions`, in priority order:

```ts
{ width, height }   // explicit pixel dimensions — both, or one + auto-aspect
{ scale }           // multiplier on the SVG's intrinsic size (default 1)
// fallback: intrinsic width/height from the SVG itself
```

When only `width` (or only `height`) is set, the missing dimension is derived from the SVG's `viewBox` or intrinsic aspect ratio so the output never stretches.

## Anti-aliasing

The fill path uses an **analytical AA** scanline rasterizer with 4× horizontal sub-sampling: every output pixel is decomposed into four sub-pixel columns, edges are clipped to each column's interval, and the accumulated coverage is averaged into the pixel's alpha. The result is a clean half-pixel ramp on every edge angle without the box-filter shimmer of unscaled supersampling.

Fill rule defaults to `nonzero`. `fill-rule="evenodd"` flips the parity test for self-intersecting paths.

## Flattening tolerance

Curves are not rasterised analytically — they're flattened to straight-line segments first. The tolerance (in SVG user units) controls the maximum distance between the curve and its polygonal approximation:

```ts
rasterize(root, { tolerance: 0.25 }) // default — pixel-grade smoothness
rasterize(root, { tolerance: 1.0  }) // chunkier curves, fewer vertices
rasterize(root, { tolerance: 0.05 }) // sub-pixel — useful for very high scale factors
```

Lower tolerance → more polygon vertices → slower rasterise but smoother curves. The default is tuned for `scale: 1` output; bump it down proportionally if you're rendering at large `scale`.

The same tolerance applies to:

- **Cubic Béziers** (`C`, `c`, `S`, `s`, and SVG primitives that lower to cubics).
- **Quadratic Béziers** (`Q`, `q`, `T`, `t`).
- **Arcs** (`A`, `a`) — converted to a chain of cubics first, then flattened.

## Backgrounds

`background` accepts either a CSS colour string or an `RGBA` literal. With nothing set, the framebuffer starts fully transparent.

```ts
rasterize(root, { background: 'transparent' })            // default
rasterize(root, { background: '#ffffff' })                // opaque white
rasterize(root, { background: { r: 14, g: 165, b: 233, a: 255 } })
```

The background is painted **before** the SVG, so semi-transparent shapes blend onto it.

## `currentColor`

`fill="currentColor"` and `stroke="currentColor"` resolve against the `currentColor` option (or the [config default](/config)):

```ts
rasterize(root, { currentColor: '#1f2937' })
```

Use this when an SVG icon expects a CSS `color` cascade — you control the brand colour without rewriting the markup.

## `<use>` recursion

`<use href="#shape">` instantiates the referenced node in place. Nested `<use>` chains are allowed; cycles are not. `maxUseDepth` (default `16`) is the hard cap — depth `0` means a `<use>` can't reference another `<use>`. The default is generous enough for any sane document and short enough to abort runaway recursion fast.

## What gets skipped

- `<text>` without a [font resolver](/features/text).
- `<image>` without an [image resolver](/advanced/image-resolvers) (a transparent placeholder of the right size is drawn instead, so layout stays stable).
- Unknown elements (`<filter>`, `<style>`, `<pattern>`, …) — dropped at parse time, not at render time.

## Coordinate system

The framebuffer is **top-to-bottom, left-to-right**, RGBA, premultiplied no (straight alpha). `data[(y * width + x) * 4 + 0]` is the red channel of the pixel at `(x, y)`. PNG encoding doesn't transform this — what you see in `Uint8Array` is what lands in the file.

## Re-rendering

`rasterize` is pure on its input. The same `SVGRoot` can be rasterised at different sizes, tolerances, or backgrounds without a re-parse:

```ts
const root = parseSVG(svg)
const thumb = rasterize(root, { width: 128 })
const hero = rasterize(root, { width: 2048 })
```

For batch workflows where the SVG is fixed but options vary, this is significantly cheaper than calling `svgToPng` repeatedly.
