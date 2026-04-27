# Paint servers

`fill` and `stroke` aren't just colours — they can also be `url(#id)` references to a paint server. ts-svg supports linear and radial gradients, including the bits that make real-world icons look right: `objectBoundingBox` units, `gradientTransform`, and `xlink:href` chaining.

## Linear gradients

```svg
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#0ea5e9" />
  <stop offset="100%" stop-color="#1d4ed8" />
</linearGradient>

<rect width="200" height="100" fill="url(#bg)" />
```

`x1`/`y1`/`x2`/`y2` define the gradient axis. With `gradientUnits="userSpaceOnUse"` (default) they're in SVG user coordinates; with `objectBoundingBox` they're in `0..1` units relative to the filled shape's bounds.

Parsed shape:

```ts
interface SVGLinearGradient {
  tag: 'linearGradient'
  id: string
  x1: number; y1: number; x2: number; y2: number
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  spreadMethod: 'pad' | 'reflect' | 'repeat'
  stops: SVGGradientStop[]
  gradientTransform?: Matrix
}
```

## Radial gradients

```svg
<radialGradient id="orb" cx="0.5" cy="0.5" r="0.5" fx="0.3" fy="0.3"
                gradientUnits="objectBoundingBox">
  <stop offset="0%" stop-color="white" />
  <stop offset="100%" stop-color="#0ea5e9" />
</radialGradient>
```

`cx`/`cy`/`r` are the gradient circle; `fx`/`fy` are the focal point (defaults to the centre). With `objectBoundingBox` units the values are relative to the shape; with `userSpaceOnUse` they're in user pixels.

## Spread method

`spreadMethod="pad" | "reflect" | "repeat"` controls what happens beyond the last stop:

- `pad` (default) — extend the end colours.
- `reflect` — bounce the gradient back on itself.
- `repeat` — tile the gradient.

All three are honoured for both linear and radial gradients.

## Gradient transforms

`gradientTransform` is parsed via [`parseTransform`](/api#transform) and composed with the surrounding cascade. So:

```svg
<linearGradient id="diag"
                gradientTransform="rotate(45)"
                x1="0" y1="0" x2="1" y2="0"
                gradientUnits="objectBoundingBox">
  …
</linearGradient>
```

…rotates the gradient axis 45° regardless of the shape it's applied to.

## `xlink:href` chaining

A gradient can inherit stops from another gradient by reference. ts-svg follows these chains during parsing, so the resolved gradient on the renderer has its full stop list inlined:

```svg
<linearGradient id="base">
  <stop offset="0" stop-color="black" />
  <stop offset="1" stop-color="white" />
</linearGradient>

<linearGradient id="rotated"
                xlink:href="#base"
                gradientTransform="rotate(90)" />
```

Both `<linearGradient>` and `<radialGradient>` participate; you can mix gradient types as long as the chain terminates somewhere with stops.

## Stops

```ts
interface SVGGradientStop {
  offset: number   // 0..1
  color: RGBA
}
```

`stop-color`, `stop-opacity`, named colours, hex, `rgb()`, and `currentColor` (resolved against the [config](/config) value) all parse correctly. Stops are sorted by offset; missing offsets get equally-spaced defaults.

## Where gradients live

Every parsed gradient ends up on `SVGRoot.defs.gradients`, keyed by `id`. To inspect them:

```ts
const root = parseSVG(svg)
for (const [id, grad] of root.defs.gradients) {
  console.log(id, grad.tag, grad.stops.length)
}
```

You can mutate or insert gradients programmatically before rendering — the renderer reads from `defs` at draw time, not from your original markup.

## What's not supported

- `<pattern>` paint servers.
- SVG 2's `mesh` gradients.
- Cross-document gradient references (`xlink:href="other.svg#g"`). All references must resolve within the same document.

For solid-colour fills (the common case), see the [Element tree](/features/parser) — every shape's `fill` and `stroke` field is just a CSS colour string.
