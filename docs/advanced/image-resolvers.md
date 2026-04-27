# Image resolvers

`<image href="…">` references raster images that ts-svg can't decode itself — JPEG, PNG, WebP, etc. (decoding bitmaps is out of scope for an SVG library). Instead, ts-svg calls a resolver function and asks you for the pixels.

If you don't pass an `imageResolver`, every `<image>` in the document draws as a transparent placeholder of the right size. Layout stays stable; pixels are missing.

## The contract

```ts
type ImageResolver = (href: string) => ResolvedImage | null

interface ResolvedImage {
  width: number
  height: number
  data: Uint8Array // RGBA, row-major, top-to-bottom
}
```

`href` is the raw value from the `<image>` element — could be a `https://…` URL, a `data:image/png;base64,…` URI, a relative file path, or anything else the SVG author wrote. The resolver decides what to fetch and how to decode.

Return `null` to leave the placeholder — the rest of the document still renders.

## Sync-only

The resolver is synchronous. ts-svg's render pipeline is synchronous end-to-end (this is what lets it work inside `bun build --compile` binaries). If you need to fetch images over HTTP, do it before calling `rasterize`:

```ts
import { svgToPng, type ImageResolver } from 'ts-svg'

// Pre-fetch every <image href> referenced by the SVG
const imageData = new Map<string, ResolvedImage>()
for (const href of extractImageHrefs(svgString)) {
  const decoded = await fetchAndDecode(href)
  imageData.set(href, decoded)
}

const imageResolver: ImageResolver = href => imageData.get(href) ?? null
const png = svgToPng(svgString, { imageResolver })
```

`extractImageHrefs` is whatever scan you want — a regex on the source, or a tree-walk after `parseSVG`.

## Decoding bitmaps

Pick whatever decoder you like; ts-svg is agnostic. With Bun:

```ts
import sharp from 'sharp' // or the Bun-compatible decoder of your choice

async function decode(buf: Buffer): Promise<ResolvedImage> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
  }
}
```

For pure-TS (no native deps): `@stacksjs/ts-png` for PNG, plus a JPEG decoder of your choice. The `data` buffer must be RGBA; if your decoder hands back RGB, `ensureAlpha()` (or its equivalent) is mandatory.

## `data:` URIs

Common case — the SVG inlines a PNG as `data:image/png;base64,…`. Decode in two steps: base64 → bytes, bytes → RGBA.

```ts
import png from '@stacksjs/ts-png'

const imageResolver: ImageResolver = (href) => {
  if (!href.startsWith('data:')) return null
  const [header, b64] = href.split(',')
  const bytes = Buffer.from(b64, 'base64')
  if (header.includes('image/png')) {
    const decoded = png.sync.read(bytes)
    return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) }
  }
  return null
}
```

Cache the result if the same `data:` URI appears multiple times (sprite atlases referenced by multiple `<use>` instances).

## Layout

The resolver only provides pixels — it doesn't see the `<image>` element's `width` / `height` / `preserveAspectRatio`. ts-svg handles all the layout:

- The element's `width` / `height` set the destination box.
- `preserveAspectRatio` controls letterboxing / cropping when aspect ratios differ.
- The image is sampled with bilinear interpolation by default.

Return the *intrinsic* dimensions of the bitmap. ts-svg scales it to fit the SVG element's dimensions.

## Caching

Resolver calls happen during `rasterize` — the same href referenced multiple times gets called multiple times unless you cache:

```ts
const cache = new Map<string, ResolvedImage>()

const imageResolver: ImageResolver = (href) => {
  let cached = cache.get(href)
  if (cached) return cached
  cached = decodeSomehow(href)
  if (cached) cache.set(href, cached)
  return cached
}
```

For a static document, the `extractImageHrefs` pre-fetch pattern at the top of this page does the same thing more explicitly.

## Failure semantics

Returning `null` is the right answer for "I don't have it" — the placeholder draws and the rest of the document renders. Throwing inside the resolver propagates out of `rasterize` and aborts the render — useful when an image *must* be present and you'd rather fail loudly.

## Limits

- No streaming — `ResolvedImage.data` must be the entire decoded buffer.
- No premultiplied alpha — pass straight RGBA. If your decoder hands back premultiplied data, divide alpha out before returning.
- No DPI awareness — the resolver doesn't see ts-svg's render scale, and ts-svg doesn't see the image's source DPI. If you need crisp images at high `scale`, hand back a higher-resolution decode.
