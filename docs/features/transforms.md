# Transforms

SVG transforms are 2×3 affine matrices applied to the coordinate system. ts-svg parses every form of the `transform` attribute, composes them through the cascade, and exposes the math primitives so you can compose your own.

## Matrix shape

```ts
type Matrix = readonly [number, number, number, number, number, number]
//                       a    b    c    d    tx   ty
```

Applied to a point as:

```
x' = a*x + c*y + tx
y' = b*x + d*y + ty
```

This matches the SVG spec exactly (and the canvas 2D context's `setTransform`).

## Parsing

```ts
import { parseTransform } from 'ts-svg'

parseTransform('translate(10,20)')
parseTransform('rotate(45 50 50)')
parseTransform('scale(2)')
parseTransform('skewX(15)')
parseTransform('matrix(1, 0.2, -0.1, 1, 0, 0)')

parseTransform('translate(10 20) rotate(30) scale(2)') // composed left-to-right
```

Whitespace, commas, optional second arguments — all accepted. The result is a single `Matrix` representing the composed transform.

## Composition

```ts
import { multiply, IDENTITY } from 'ts-svg'

const a = parseTransform('translate(10, 0)')
const b = parseTransform('scale(2)')

multiply(a, b)
// applies `b` first, then `a` — same convention as SVG transform=""
```

`multiply` is exposed because composing transforms by hand is cheaper than re-parsing strings when you're driving an animation.

## Cascade

Every node has an optional `transform: Matrix` field. The renderer maintains a running "current transform" as it walks the tree:

```
root → group A (translate) → group B (rotate) → shape (scale)
```

The shape's effective transform is `root · A · B · shape`. That composed matrix is what's used to transform path vertices into device pixels.

## Per-element examples

```svg
<g transform="translate(50, 0)">
  <rect x="0" y="0" width="20" height="20" />        <!-- effectively at (50, 0) -->
  <g transform="rotate(45)">
    <rect x="0" y="0" width="20" height="20" />      <!-- rotated 45° around (50, 0) -->
  </g>
</g>
```

The cascade is composed at parse time onto each node's `transform` field — the renderer doesn't re-multiply on every draw.

## Inverting

```ts
import { invertMatrix, applyMatrix } from 'ts-svg'

const m = parseTransform('rotate(30) scale(2)')
const mi = invertMatrix(m)
if (mi) {
  const [x, y] = applyMatrix(mi, 100, 50) // device pixel → user space
}
```

`invertMatrix` returns `null` for singular matrices (zero determinant). Common case: a `scale(0)` somewhere up the chain.

## Apply a point

```ts
import { applyMatrix } from 'ts-svg'

const [x, y] = applyMatrix(m, 0, 0) // user-space (0, 0) → device pixels
```

Useful for hit-testing — given a click in device coordinates, walk the tree, invert each node's transform, and check whether the point falls inside its geometry.

## `gradientTransform`

`<linearGradient>` and `<radialGradient>` carry their own `gradientTransform` field. It's parsed by the same `parseTransform` and composed with the surrounding cascade at render time. See [Paint servers](/features/paint-servers).

## What's not supported

- 3D transforms (`matrix3d`, `perspective`). SVG only specifies 2D affine; ts-svg doesn't extend beyond that.
- CSS `transform` syntax. The SVG `transform="…"` attribute and the CSS `transform:` property have slightly different grammars. ts-svg implements the SVG one. CSS transform from `<style>` blocks isn't applied because `<style>` blocks aren't applied at all yet.
