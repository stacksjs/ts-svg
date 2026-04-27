# Resvg shim

`import { Resvg } from 'ts-svg'` is a class-shaped façade that mirrors `@resvg/resvg-js`. The goal is straightforward: change one import, ship the same code, ditch the native dependency.

## What's compatible

| `@resvg/resvg-js` | ts-svg | Notes |
| --- | --- | --- |
| `new Resvg(svg, opts)` | ✅ | SVG is parsed eagerly; the tree is cached on the instance. |
| `resvg.render()` | ✅ | Returns a `RenderedImage`. |
| `image.asPng()` | ✅ | Returns a `Buffer`. |
| `image.pixels()` | ✅ | Returns a *copy* of the RGBA `Uint8Array` (resvg-js handed back the live buffer; ts-svg makes a copy to avoid action-at-a-distance bugs). |
| `image.width()` / `image.height()` | ✅ | |
| `fitTo: { mode, value }` | ✅ | All four modes — `original`, `zoom`, `width`, `height`. |
| `background` | ✅ | Any CSS colour string. |
| `tolerance` | ✅ | Bezier flattening tolerance. |
| `currentColor` | ✅ | Resolves `currentColor` references. |
| `maxUseDepth` | ✅ | Hard cap on `<use>` recursion. |
| `fontResolver` | ✅ | See [Font resolvers](/advanced/font-resolvers). |

## What's accepted but no-op

These options are typed for compatibility — your call sites compile with no changes — but ts-svg doesn't act on them yet. Listed so you know what's happening:

| Option | Status |
| --- | --- |
| `font` | resvg-js bundled font loading; ts-svg uses `fontResolver` instead. |
| `dpi` | accepted, ignored — pixel sizing comes from `fitTo` / `RenderOptions.scale`. |
| `shapeRendering`, `textRendering`, `imageRendering` | accepted, ignored — rendering quality is a single pipeline. |
| `logLevel` | accepted, ignored — use `verbose: true` in [`svg.config.ts`](/config) instead. |
| `imagesToResolve` | accepted, ignored — use `imageResolver` (see [Image resolvers](/advanced/image-resolvers)). |
| `crop` | parsed, ignored — file an issue if you need it. |

If you rely on any of these and ts-svg's defaults aren't equivalent, file an issue with a sample. Most are tractable.

## Migration checklist

1. **Swap the import.**
   ```ts
   // Before
   import { Resvg } from '@resvg/resvg-js'
   // After
   import { Resvg } from 'ts-svg'
   ```
2. **Drop the native dep** from `package.json` (`@resvg/resvg-js` and any platform-specific siblings).
3. **Wire up text** if your call sites render `<text>`. resvg-js reads system fonts; ts-svg uses `fontResolver`. See [Font resolvers](/advanced/font-resolvers).
4. **Wire up images** if your call sites render `<image>`. resvg-js fetches them; ts-svg uses `imageResolver`. See [Image resolvers](/advanced/image-resolvers).
5. **Run your tests.** The `RenderedImage.pixels()` copy semantics are stricter than resvg-js — if your code mutated the returned `Uint8Array` and expected the next `.asPng()` to reflect that mutation, that's a behaviour change. (It was always a bug; it just wasn't caught.)

## Re-rendering is cheap

The constructor parses the SVG once. Every `render()` after the first is just rasterise + encode:

```ts
const r = new Resvg(svg)

// re-render at different sizes without re-parsing
r.render() // intrinsic size
new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render()
```

If you render the same SVG at different sizes a lot, hoist the `Resvg` instance out of your hot path.

## Buffer reuse

`renderInto(fb)` is a ts-svg extension (resvg-js doesn't have it) for the case where you're rendering many frames and want to avoid allocating an RGBA `Uint8Array` per frame:

```ts
import { Resvg, createFramebuffer, TRANSPARENT } from 'ts-svg'

const resvg = new Resvg(svg)
const fb = createFramebuffer(800, 600, TRANSPARENT)

for (const frame of frames) {
  resvg.renderInto(fb)
  encode(fb)
}
```

See [Buffer reuse](/advanced/buffer-reuse) for the full lifecycle.

## When NOT to use the shim

If you're starting from scratch, `svgToPng(svg, opts)` or the `parseSVG` → `rasterize` → `encodePng` pipeline is more idiomatic — they take plain options instead of a constructor + method dance, and they expose the typed element tree. Use the shim when you have an existing resvg-js call site and don't want to touch it.
