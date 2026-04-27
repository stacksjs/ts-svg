# Clip-paths and masks

`<clipPath>` and `<mask>` are how SVG composes one shape's outline with another shape's pixels. ts-svg supports both, including the `objectBoundingBox` units variant and SVG 2's `mask-type="alpha"`.

## Clip-paths

A clip-path is a binary stencil — a pixel either passes through or it doesn't.

```svg
<defs>
  <clipPath id="circle-clip">
    <circle cx="50" cy="50" r="40" />
  </clipPath>
</defs>

<image clip-path="url(#circle-clip)" href="..." width="100" height="100" />
```

The `<clipPath>` content can be any combination of `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`, `<polyline>`, `<path>`, `<line>`, `<use>`. Multiple shapes in a single clip-path are unioned (their interiors combine).

Parsed shape:

```ts
interface SVGClipPath {
  tag: 'clipPath'
  id: string
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  children: SVGNode[]
  attrs: Record<string, string>
}
```

`clipPathUnits="objectBoundingBox"` rescales the clip geometry to the `0..1` bounding box of the clipped element. So a `<rect width="1" height="1" />` inside an `objectBoundingBox` clip-path covers the entire clipped shape regardless of its size.

## Masks

A mask modulates *alpha* — pixels can be partially transparent based on the mask's content:

```svg
<defs>
  <mask id="vignette" maskUnits="userSpaceOnUse">
    <rect width="200" height="100" fill="black" />
    <circle cx="100" cy="50" r="50" fill="white" />
  </mask>
</defs>

<image mask="url(#vignette)" href="..." width="200" height="100" />
```

Black mask pixels make the target fully transparent; white mask pixels leave it fully opaque; greys interpolate.

Parsed shape:

```ts
interface SVGMask {
  tag: 'mask'
  id: string
  units: 'userSpaceOnUse' | 'objectBoundingBox'         // maskUnits
  contentUnits: 'userSpaceOnUse' | 'objectBoundingBox'  // maskContentUnits
  maskType: 'luminance' | 'alpha'
  x?, y?, width?, height?: number
  children: SVGNode[]
  attrs: Record<string, string>
}
```

`maskUnits` controls how the mask's `x`/`y`/`width`/`height` are interpreted. `maskContentUnits` controls the mask's *contents*' coordinate space.

## `mask-type`

```svg
<mask id="m" mask-type="alpha"> … </mask>
```

| `mask-type` | Modulation |
| --- | --- |
| `luminance` (default) | Brightness of the mask pixels (Rec. 709 luma) drives target alpha. |
| `alpha` | The mask pixels' alpha drives target alpha — the colour channels are ignored. |

Use `mask-type="alpha"` when your mask is a series of shapes with explicit `fill-opacity` — you don't have to convert them to greyscale to get the right effect.

## How they cascade

`clip-path` and `mask` are inherited like any other presentation attribute. Putting them on a `<g>` applies them to every descendant in one composite step:

```svg
<g clip-path="url(#circle-clip)">
  <rect ... />
  <text ... />
  <path ... />
</g>
```

The group is rendered to an offscreen buffer, the clip-path is applied to the buffer, and the result is composited onto the framebuffer.

## Combining clip and mask

You can apply both to the same element. The clip-path is applied first (binary stencil), the mask is applied second (alpha modulation). The order is fixed by the SVG spec; ts-svg follows it.

## What's not supported

- `<filter>` — Gaussian blur, drop shadow, colour matrices. None of the SVG filter primitives are implemented yet. Mask + clip cover most of the cases people actually want.
- Cross-document `clip-path` / `mask` references (`url(other.svg#id)`) — references must resolve within the same document.

## Where they live

Clip-paths live on `SVGRoot.defs.clipPaths`, masks on `SVGRoot.defs.masks`. Both are keyed by `id` for O(1) lookup.

```ts
const root = parseSVG(svg)
console.log([...root.defs.clipPaths.keys()]) // ['circle-clip', ...]
console.log([...root.defs.masks.keys()])     // ['vignette', ...]
```

Walk the `children` of either to inspect or mutate the masking geometry programmatically.
