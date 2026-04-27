# Text

ts-svg renders `<text>` by asking *you* for a font. The library doesn't bundle font data — it asks you for a `ResolvedFont`, runs `getPath()`, and rasterises the resulting path. Without a font resolver, `<text>` is silently skipped (no missing-glyph boxes, no fallback fonts).

This split keeps the library tiny and lets you bring whatever font stack you want — `opentype.js`, a custom shaper, a baked-in glyph atlas.

## Parsed shape

```ts
interface SVGText extends BaseNode {
  tag: 'text'
  x: number
  y: number
  textAnchor: 'start' | 'middle' | 'end'
  fontFamily: string
  fontSize: number
  text: string         // whitespace-collapsed inner text
}
```

Inherited fields from `BaseNode` (fill, stroke, opacity, transform, …) apply just like any other element.

## Hooking in a resolver

```ts
import { Font } from 'opentype.js'
import { svgToPng, type FontResolver } from 'ts-svg'

const inter = await Font.load('./Inter-Regular.otf') // opentype.js Font

const fontResolver: FontResolver = (familyList, sizeHint) => {
  // familyList is the raw `font-family` value, e.g. "Inter, sans-serif"
  if (familyList.includes('Inter')) return inter
  return null // skip rendering
}

svgToPng(svg, { fontResolver })
```

`opentype.js`'s `Font` already implements the `getPath` and `getAdvanceWidth` methods ts-svg expects, so it works out of the box.

## What `ResolvedFont` must do

```ts
interface ResolvedFont {
  getPath: (text: string, x: number, y: number, fontSize: number, options?: ResolvedFontOptions) =>
    { toPathData: (decimals?: number) => string }
  getAdvanceWidth: (text: string, fontSize: number, options?: ResolvedFontOptions) => number
}
```

- `getPath` returns an object with a `toPathData()` method. The string it returns is fed to [`parsePath`](/api#path) — so any SVG-grammar path works.
- `getAdvanceWidth` returns the rendered text's advance width in user units. Used for `text-anchor` alignment (`middle` shifts left by half-width; `end` shifts left by full width).

That's all ts-svg uses. Anything else `opentype.js` exposes is fair game but not required.

## Custom resolver from scratch

For tiny use cases (icons with a single styled label, generated charts with a fixed font), you can hand-roll a resolver:

```ts
import { type FontResolver, type ResolvedFont } from 'ts-svg'

const ROBOTO_M_PATH = 'M ...' // pre-baked glyph

const fontResolver: FontResolver = (familyList) => {
  if (!familyList.toLowerCase().includes('roboto')) return null
  return {
    getPath: (text, x, y, fontSize) => ({
      toPathData: () => /* synthesise path-data here */,
    }),
    getAdvanceWidth: (text, fontSize) => text.length * fontSize * 0.5,
  } satisfies ResolvedFont
}
```

For real workloads, use a real shaper — fake metrics break alignment for anything beyond Latin.

## `text-anchor`

| Value | Position |
| --- | --- |
| `start` (default) | Text starts at `x`. |
| `middle` | Text is centred on `x`. |
| `end` | Text ends at `x`. |

ts-svg uses `getAdvanceWidth` to compute the offset before rasterising — your resolver doesn't need to handle alignment itself.

## What's not implemented

- `<tspan>` per-glyph positioning (`x="…" dy="…"` arrays).
- Bidi reordering for RTL scripts.
- OpenType feature toggles plumbed from CSS / SVG attributes — you can pass them via `ResolvedFontOptions.features` if your resolver supports them, but ts-svg doesn't read them off the SVG tree.

For these, prepare the text shape externally (e.g. with HarfBuzz) and emit a `<path>` directly. ts-svg renders paths beautifully.

## Skipping vs failing

If the resolver returns `null`, the `<text>` is dropped from the rasterised output and the rest of the document continues. There is no thrown error, no warning unless `verbose: true` in [config](/config). This is intentional — it means a stylesheet that references a font you don't have falls back gracefully rather than blowing up the whole render.

## Recipe: bundling a font with `bun build --compile`

When you compile to a single binary, ship the font as an embedded asset:

```ts
import font from './Inter-Regular.otf' with { type: 'file' }
import { Font } from 'opentype.js'

const inter = await Font.load(font)
```

See [Advanced → Font resolvers](/advanced/font-resolvers) for more recipes.
