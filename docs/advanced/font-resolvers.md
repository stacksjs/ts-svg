# Font resolvers

ts-svg renders `<text>` by calling a function you provide. The function maps a `font-family` request to a `ResolvedFont` — an object that exposes `getPath` and `getAdvanceWidth`. This page is a recipe collection.

## The contract

```ts
type FontResolver = (familyList: string, sizeHint: number) => ResolvedFont | null

interface ResolvedFont {
  getPath: (text: string, x: number, y: number, fontSize: number, options?: ResolvedFontOptions) =>
    { toPathData: (decimals?: number) => string }
  getAdvanceWidth: (text: string, fontSize: number, options?: ResolvedFontOptions) => number
}
```

- `familyList` is the raw `font-family` value from the SVG, e.g. `"Inter, sans-serif"`. ts-svg doesn't pre-split or normalise it; that's your call.
- `sizeHint` is the SVG's `font-size`. Use it to pick a static size variant if your collection has one (e.g. an `Inter-Display` for sizes ≥ 32).
- Return `null` to skip — the `<text>` element will be dropped from the render.

## opentype.js

`opentype.js` `Font` instances already satisfy `ResolvedFont` — `getPath` returns a `Path` object whose `toPathData()` method emits SVG path data, and `getAdvanceWidth` exists as-is.

```ts
import { Font } from 'opentype.js'
import { svgToPng, type FontResolver } from 'ts-svg'

const fonts = {
  inter: await Font.load('./fonts/Inter-Regular.otf'),
  interBold: await Font.load('./fonts/Inter-Bold.otf'),
  jetbrains: await Font.load('./fonts/JetBrainsMono-Regular.ttf'),
}

const fontResolver: FontResolver = (familyList) => {
  const lc = familyList.toLowerCase()
  if (lc.includes('jetbrains')) return fonts.jetbrains
  if (lc.includes('inter')) return fonts.inter
  return null
}

svgToPng(svg, { fontResolver })
```

## Bold / italic / weight

The `font-weight` and `font-style` attributes aren't exposed on `SVGText` directly — you parse them yourself if you need them. The simplest pattern is family-name matching in your resolver:

```ts
const fontResolver: FontResolver = (familyList) => {
  // "Inter" "Inter-Bold" "Inter-Italic" — match on the resolved family
  if (/inter[-\s]?bold/i.test(familyList)) return fonts.interBold
  if (/inter/i.test(familyList))           return fonts.inter
  return null
}
```

For richer matching you'd look at `fontWeight` / `fontStyle` on `node.attrs` while pre-walking the tree to rewrite `font-family` to a fully-qualified name.

## Fontkit

[Fontkit](https://github.com/foliojs/fontkit) doesn't quite match the shape — it returns a `Glyph[]` rather than a path object. Wrap it:

```ts
import fontkit from 'fontkit'
import type { ResolvedFont, FontResolver } from 'ts-svg'

function wrap(fk: fontkit.Font): ResolvedFont {
  return {
    getPath(text, x, y, fontSize) {
      const run = fk.layout(text)
      const scale = fontSize / fk.unitsPerEm
      let cursor = x
      const segments: string[] = []
      for (const glyph of run.glyphs) {
        // glyph.path is a fontkit Path — emit its commands offset by cursor
        segments.push(translatePath(glyph.path.toSVG(), cursor, y, scale))
        cursor += glyph.advanceWidth * scale
      }
      const data = segments.join(' ')
      return { toPathData: () => data }
    },
    getAdvanceWidth(text, fontSize) {
      const scale = fontSize / fk.unitsPerEm
      return fk.layout(text).glyphs.reduce((w, g) => w + g.advanceWidth * scale, 0)
    },
  }
}

const inter = fontkit.openSync('./Inter-Regular.otf')
const fontResolver: FontResolver = () => wrap(inter)
```

`translatePath` is left as an exercise — multiply each `M`/`L`/`C` coordinate by `scale` and offset by the cursor. Or pre-bake glyphs to paths once at startup and cache them.

## Bundled fonts (`bun build --compile`)

```ts
// font.ts
import inter from './fonts/Inter-Regular.otf' with { type: 'file' }
import { Font } from 'opentype.js'

export const interFont = await Font.load(inter)
```

Bun embeds the file into the compiled binary; the resolver picks it up at runtime with no filesystem access.

For Node, do the equivalent with `import.meta.url` + `readFile`.

## Caching at the resolver layer

`getPath` is called once per `<text>` element. If the same string is rendered repeatedly (e.g. axis labels in a chart), short-circuit at the resolver:

```ts
const cache = new Map<string, ResolvedFont>()

const fontResolver: FontResolver = (familyList, sizeHint) => {
  const key = `${familyList}@${sizeHint}`
  let resolved = cache.get(key)
  if (resolved) return resolved
  resolved = pickFont(familyList) ?? null
  if (resolved) cache.set(key, resolved)
  return resolved
}
```

Don't cache `getPath` results unless you're sure the text content is also stable — you'd lose dynamic labels.

## Skipping vs. fallback

`null` from the resolver = skip. There is no system-fallback mechanism in ts-svg; the library never reads system fonts. If you want a fallback chain ("try Inter, else Roboto, else skip"), implement it inside your resolver.

## Sizing pitfalls

`fontSize` is in **SVG user units**, not device pixels. If you're rendering at `scale: 2`, a `font-size="14"` element draws as 28 device pixels — but your resolver still sees `14`. The renderer composes the scale transform onto the path coordinates *after* the resolver has produced them.

This means: don't pre-scale the path inside `getPath`. Return path data in SVG-user-space and let the cascade scale it.
