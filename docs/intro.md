<p align="center"><img src="https://github.com/stacksjs/ts-svg/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# Introduction

`ts-svg` is a pure-TypeScript SVG parser, rasterizer, and PNG encoder. It runs anywhere Bun or Node runs and ships in three layers you can mix and match:

1. **Convenience pipeline** — `svgToPng(svg, opts)` for one-shot rendering.
2. **Element-tree API** — `parseSVG` → `rasterize` → `encodePng` when you want to inspect or mutate the document between parse and render.
3. **`Resvg` shim** — a class-shaped façade compatible with `@resvg/resvg-js`, so you can migrate without touching call sites.

Internally, every shape is flattened to polygons and drawn with an analytical anti-aliased rasterizer (4× horizontal sub-sampling, non-zero fill rule). Curves and arcs use adaptive subdivision driven by a flatness tolerance you control.

## Why ts-svg

- **No native bindings.** No `node-gyp`, no platform-specific binaries, no WASM blob to ship in your bundle. Works inside `bun build --compile`, edge runtimes, and locked-down environments where `@resvg/resvg-js` or `sharp` can't go.
- **Typed end to end.** `parseSVG` returns a discriminated-union `SVGNode` tree (`SVGRect`, `SVGPath`, `SVGGroup`, …), not a generic AST you have to second-guess. Every renderer option, every config field, every paint server has a TypeScript interface.
- **Drop-in for the common path.** If you're already using `@resvg/resvg-js`, switching is one import change. The shim covers `fitTo`, `background`, `tolerance`, `currentColor`, `fontResolver`, and the `RenderedImage` API (`asPng`, `pixels`, `width`, `height`).
- **Pixel-tested.** Every supported element has a fixture test that asserts specific colours at specific coordinates, so regressions are caught immediately rather than as "looks slightly off."

## Quick example

```ts
import { svgToPng } from 'ts-svg'
import { writeFileSync } from 'node:fs'

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
  <rect width="100%" height="100%" fill="#0ea5e9"/>
  <text x="100" y="50" text-anchor="middle"
        font-family="sans-serif" font-size="24" fill="white">ts-svg</text>
</svg>`

writeFileSync('out.png', svgToPng(svg, { scale: 2 }))
```

`<text>` rendering needs a [font resolver](/advanced/font-resolvers); without one, text is silently skipped.

## When to reach for which API

| You want to… | Use |
| --- | --- |
| Convert one SVG to one PNG | `svgToPng(svg, opts)` |
| Inspect, mutate, or re-render the document | `parseSVG` → `rasterize` → `encodePng` |
| Migrate from `@resvg/resvg-js` | `import { Resvg } from 'ts-svg'` |
| Composite ts-svg output into your own pixel buffer | `Resvg#renderInto(fb)` |
| Customise paths, transforms, or colour parsing yourself | re-export the lower-level helpers (`parsePath`, `parseTransform`, `parseColor`, …) |

## What's supported

`svg`, `g`, `defs`, `rect`, `circle`, `ellipse`, `line`, `polygon`, `polyline`, `path`, `text` (with a font resolver), `image` (with an image resolver), `use`, `linearGradient`, `radialGradient`, `clipPath`, `mask`. Stroke styling covers `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, and `stroke-dashoffset`. Paint servers honour `gradientUnits="objectBoundingBox"` and `xlink:href` chaining. SVG 2 attributes — `paint-order`, `mask-type="alpha"`, `vector-effect="non-scaling-stroke"` — are honoured too.

See the [Features section](/features/parser) for deep dives on each capability.

## What's out of scope today

`<style>` / CSS selector resolution, `<filter>` (no Gaussian blur, drop shadow, etc.), `<pattern>`, `<symbol>` advanced semantics, and per-glyph `<tspan>` positioning. If you need any of these, file an issue — most are tractable, they just aren't implemented yet.

## Next steps

- [Install ts-svg](/install) — package managers and prebuilt CLI binaries.
- [Usage walkthrough](/usage) — library API, the `Resvg` shim, and the `svg` CLI.
- [API reference](/api) — every export with its signature.
- [Configuration](/config) — `svg.config.ts` defaults that apply project-wide.
- [Features](/features/parser) — what each capability does and how to use it.
- [Advanced](/advanced/resvg-shim) — buffer reuse, font/image resolvers, performance.

## Community

- [Discussions on GitHub](https://github.com/stacksjs/ts-svg/discussions)
- [Stacks Discord](https://discord.gg/stacksjs)

## License

The MIT License (MIT). See [LICENSE](https://github.com/stacksjs/ts-svg/tree/main/LICENSE.md).
