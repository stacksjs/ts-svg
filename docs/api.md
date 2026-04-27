# API Reference

Every public symbol exported from `ts-svg`. Types are listed alongside the functions that use them.

## Pipeline

### `svgToPng(svg, opts?)`

```ts
function svgToPng(svg: string, opts?: RenderOptions): Buffer
```

`parseSVG` + `rasterize` + `encodePng` in one call. Use this when you don't need to inspect or mutate the document.

### `parseSVG(svg)`

```ts
function parseSVG(svg: string): SVGRoot
```

Parses an SVG string into a typed element tree. Throws if `svg` is not well-formed XML or doesn't begin with an `<svg>` element. Unknown elements are dropped (with a `console.warn` if `verbose: true` in [config](/config)).

### `rasterize(root, opts?)`

```ts
function rasterize(root: SVGRoot, opts?: RenderOptions): Framebuffer
```

Walks the tree, flattens shapes to polygons, and rasterises them into an RGBA framebuffer.

### `encodePng(fb)`

```ts
function encodePng(fb: Framebuffer): Buffer
```

Encodes a framebuffer as PNG bytes. The `Framebuffer` is whatever `rasterize` returned; mutating it after encoding is fine.

## `RenderOptions`

```ts
interface RenderOptions {
  width?: number
  height?: number
  scale?: number
  background?: string | RGBA
  tolerance?: number
  fontResolver?: FontResolver
  imageResolver?: ImageResolver
  currentColor?: string | RGBA
  maxUseDepth?: number
}
```

| Field | Default | Notes |
| --- | --- | --- |
| `width` | intrinsic | Output width in pixels. Overrides `scale`. |
| `height` | intrinsic | Output height in pixels. Overrides `scale`. |
| `scale` | `1` | Multiplier on the SVG's intrinsic size. Ignored if `width` or `height` is set. |
| `background` | `'transparent'` (or `config.background`) | CSS string or RGBA literal. |
| `tolerance` | `0.25` (or `config.tolerance`) | Bezier flattening tolerance in user units (px). |
| `fontResolver` | — | Maps `<text>` elements to a `ResolvedFont`. Without it, `<text>` is skipped. |
| `imageResolver` | — | Maps `<image href=>` to RGBA pixels. Without it, `<image>` draws a transparent placeholder. |
| `currentColor` | `'black'` (or `config.currentColor`) | Resolves `currentColor` references. |
| `maxUseDepth` | `16` (or `config.maxUseDepth`) | Hard cap on `<use>` recursion. |

## `Framebuffer`

```ts
interface Framebuffer {
  width: number
  height: number
  data: Uint8Array // RGBA, row-major, top-to-bottom
}

function createFramebuffer(width: number, height: number, bg: RGBA): Framebuffer
```

`data.length === width * height * 4`. Each pixel is four consecutive bytes: red, green, blue, alpha (all `0..255`, alpha `0` = transparent).

## Resvg shim

### `Resvg`

```ts
class Resvg {
  constructor(svg: string, options?: ResvgOptions)
  render(): RenderedImage
  renderInto(fb: Framebuffer, opts?: { clear?: boolean }): void
}
```

The constructor parses the SVG once and caches the tree. Subsequent `render()` / `renderInto()` calls reuse the parse.

`renderInto(fb)` rasterises into a buffer you allocate. The buffer is zeroed first by default; `{ clear: false }` is reserved for a future composite path. Today, pixels are overwritten with the fresh render either way.

### `RenderedImage`

```ts
class RenderedImage {
  asPng(): Buffer
  pixels(): Uint8Array  // copy of the framebuffer's RGBA bytes
  width(): number
  height(): number
}
```

`pixels()` returns a *copy*. Mutating the returned array doesn't affect the underlying framebuffer.

### `ResvgOptions`

```ts
interface ResvgOptions {
  fitTo?: ResvgFitTo
  background?: string
  tolerance?: number
  currentColor?: string
  maxUseDepth?: number
  fontResolver?: FontResolver
  crop?: { left?: number, top?: number, right?: number, bottom?: number }

  // Accepted for type-compat with @resvg/resvg-js, currently no-ops:
  font?: unknown
  dpi?: number
  shapeRendering?: number
  textRendering?: number
  imageRendering?: number
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  imagesToResolve?: unknown
}
```

### `ResvgFitTo`

```ts
interface ResvgFitTo {
  mode?: 'original' | 'width' | 'height' | 'zoom'
  value?: number
}
```

| `mode` | `value` | Result |
| --- | --- | --- |
| `'original'` | — | Use intrinsic SVG dimensions. |
| `'zoom'` | factor | Multiply intrinsic dims by `value`. |
| `'width'` | px | Set width to `value`; height auto-derived from aspect ratio. |
| `'height'` | px | Set height to `value`; width auto-derived from aspect ratio. |

## Element tree types

The `SVGNode` discriminated union — every value has a literal `tag` field for narrowing.

```ts
type SVGNode = SVGRoot | SVGGroup | SVGElementNode

type SVGElementNode =
  | SVGRect | SVGCircle | SVGEllipse | SVGLine
  | SVGPolygon | SVGPath | SVGText | SVGUse | SVGImage
```

| Type | Tag |
| --- | --- |
| `SVGRoot` | `'svg'` |
| `SVGGroup` | `'g'` |
| `SVGRect` | `'rect'` |
| `SVGCircle` | `'circle'` |
| `SVGEllipse` | `'ellipse'` |
| `SVGLine` | `'line'` |
| `SVGPolygon` | `'polygon'` or `'polyline'` |
| `SVGPath` | `'path'` |
| `SVGText` | `'text'` |
| `SVGUse` | `'use'` |
| `SVGImage` | `'image'` |

Paint servers and clip/mask defs are stored on `SVGRoot.defs`:

```ts
interface SVGDefs {
  gradients: Map<string, SVGGradient>
  clipPaths: Map<string, SVGClipPath>
  masks: Map<string, SVGMask>
  byId: Map<string, SVGNode>
}

type SVGGradient = SVGLinearGradient | SVGRadialGradient
```

See [Features → Element tree](/features/parser) for field-by-field descriptions.

## Resolvers

### `FontResolver`

```ts
type FontResolver = (familyList: string, sizeHint: number) => ResolvedFont | null

interface ResolvedFont {
  getPath: (text: string, x: number, y: number, fontSize: number, options?: ResolvedFontOptions) =>
    { toPathData: (decimals?: number) => string }
  getAdvanceWidth: (text: string, fontSize: number, options?: ResolvedFontOptions) => number
}
```

`familyList` is the raw `font-family` value (CSS list, comma-separated). `opentype.js` `Font` objects already match this shape.

Recipes: [Advanced → Font resolvers](/advanced/font-resolvers).

### `ImageResolver`

```ts
type ImageResolver = (href: string) => ResolvedImage | null

interface ResolvedImage {
  width: number
  height: number
  data: Uint8Array // RGBA, row-major, top-to-bottom
}
```

Receives the raw `href` from the `<image>` element (URL, `data:` URI, file path — your choice). Return `null` to leave a transparent placeholder.

Recipes: [Advanced → Image resolvers](/advanced/image-resolvers).

## Configuration

```ts
interface SvgConfig {
  verbose: boolean
  tolerance: number
  background: string
  currentColor: string
  maxUseDepth: number
}

const config: SvgConfig
function getConfig(): Promise<SvgConfig>
```

`config` is the synchronous, eagerly available defaults object. `getConfig()` lazily merges your project's `svg.config.ts` on top.

See [Configuration](/config) for field defaults and precedence rules.

## Helpers

Lower-level building blocks that the renderer uses internally — exported because they're useful on their own.

### Path

```ts
function parsePath(d: string): PathCmd[]
function flattenCommands(cmds: PathCmd[], tolerance?: number): FlatContour[]
function flattenCubic(...): /* sample points */
function flattenQuadratic(...): /* sample points */
function arcToCubics(...): PathCmd[]
```

`parsePath` accepts the full `M m L l H h V v C c S s Q q T t A a Z z` grammar. `flattenCommands` turns the command stream into closed polygons you can rasterise yourself.

### Transform

```ts
const IDENTITY: Matrix
function multiply(a: Matrix, b: Matrix): Matrix
function applyMatrix(m: Matrix, x: number, y: number): [number, number]
function invertMatrix(m: Matrix): Matrix | null
function parseTransform(s: string): Matrix
```

`Matrix` is `readonly [a, b, c, d, tx, ty]` — the 2×3 affine SVG uses. `parseTransform` accepts the SVG `transform` attribute syntax (`translate(...)`, `rotate(...)`, etc.).

### Colour

```ts
function parseColor(input: string | null | undefined, currentColor?: RGBA): RGBA
const BLACK: RGBA       // { r: 0,   g: 0,   b: 0,   a: 255 }
const WHITE: RGBA       // { r: 255, g: 255, b: 255, a: 255 }
const TRANSPARENT: RGBA // { r: 0,   g: 0,   b: 0,   a: 0 }
```

`parseColor` handles named colours, `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`, and `'currentColor'` (resolved against the optional second argument).

### Raster primitives

```ts
function fillPolygons(fb: Framebuffer, contours: FlatContour[], paint: Paint, fillRule?: FillRule): void
function strokePolylines(fb: Framebuffer, polylines: Array<Array<[number, number]>>, paint: Paint, style: StrokeStyle): void

type Paint = RGBA | { sample: (xDev: number, yDev: number) => RGBA }
```

You can compose your own pipeline on top of these — e.g. rasterise something that isn't an SVG, but you want anti-aliased fills.

## Re-exports

Every type referenced above is re-exported from the package root; there are no sub-paths. Search by symbol name in your editor — TypeScript will find it.
