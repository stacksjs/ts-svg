# Element tree

`parseSVG(svg)` returns a typed `SVGRoot`. The tree is the source of truth for the rasterizer — everything downstream walks it.

## Why a typed tree

Most SVG-to-PNG libraries hide the parse step. ts-svg exposes it because:

- You can **mutate** before rendering (recolour, hide elements, scale paths) without string-mangling SVG markup.
- You can **inspect** after parsing to extract metadata (count shapes, sum bounding boxes, list referenced fonts).
- You get **TypeScript narrowing** via the `tag` discriminant, so `if (node.tag === 'rect')` gives you `SVGRect` autocomplete inside the block.

## Node shape

Every node extends `BaseNode`, which carries presentation defaults:

```ts
interface BaseNode {
  attrs: Record<string, string>      // raw attributes preserved for the cascade
  fill?: string | null
  stroke?: string | null
  strokeWidth?: number
  strokeLineCap?: 'butt' | 'round' | 'square'
  strokeLineJoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDashArray?: number[]
  strokeDashOffset?: number
  fillOpacity?: number
  strokeOpacity?: number
  opacity?: number
  transform?: Matrix
  clipPath?: string
  mask?: string
  fillRule?: 'nonzero' | 'evenodd'
  paintOrder?: ReadonlyArray<'fill' | 'stroke' | 'markers'>
  vectorEffect?: 'none' | 'non-scaling-stroke'
}
```

Each shape adds geometry on top:

```ts
interface SVGRect extends BaseNode {
  tag: 'rect'
  x: number; y: number; width: number; height: number
  rx?: number; ry?: number
}

interface SVGCircle extends BaseNode {
  tag: 'circle'
  cx: number; cy: number; r: number
}

// …ellipse, line, polygon (also covers polyline), path, text, use, image
```

Containers carry children:

```ts
interface SVGRoot extends BaseNode {
  tag: 'svg'
  width: number; height: number
  x: number; y: number               // 0/0 for the outermost <svg>
  viewBox?: { x, y, width, height }
  preserveAspectRatio: PreserveAspectRatio
  children: SVGNode[]
  defs: SVGDefs                      // gradients, clip-paths, masks, byId
}

interface SVGGroup extends BaseNode {
  tag: 'g'
  children: SVGNode[]
}
```

## `defs` registry

`<linearGradient>`, `<radialGradient>`, `<clipPath>`, and `<mask>` aren't kept as siblings in `children`. They're indexed on `SVGRoot.defs` so the renderer can resolve `url(#id)` references in O(1):

```ts
interface SVGDefs {
  gradients: Map<string, SVGGradient>
  clipPaths: Map<string, SVGClipPath>
  masks: Map<string, SVGMask>
  byId: Map<string, SVGNode>   // any other id-bearing element (used by <use>)
}
```

Anything with an `id=` attribute also lands in `byId`, so `<use href="#shape1">` finds its target without re-walking the tree.

## Walking

There's no built-in visitor — `children` is a plain array, walk it however you like:

```ts
import type { SVGNode } from 'ts-svg'

function walk(node: SVGNode, fn: (n: SVGNode) => void): void {
  fn(node)
  if ('children' in node) node.children.forEach(child => walk(child, fn))
}
```

`'children' in node` narrows to `SVGRoot | SVGGroup`. Leaf shapes don't have a `children` field.

## Mutating

Mutate freely — `rasterize` is pure on the input tree, so the same root can be rendered multiple times after edits:

```ts
import { parseSVG, rasterize, encodePng } from 'ts-svg'

const root = parseSVG(svg)

// Frame 1: cyan
applyFill(root, '#0ea5e9')
const frame1 = encodePng(rasterize(root))

// Frame 2: pink
applyFill(root, '#ec4899')
const frame2 = encodePng(rasterize(root))
```

## Unknown elements

Tags ts-svg doesn't recognise (e.g. `<filter>`, `<style>`, `<pattern>`) are dropped during parsing. With `verbose: true` in [config](/config), each one logs a `console.warn`. The rest of the document still parses normally.

## Round-tripping

There's no built-in serialiser — the parse direction is the supported one. If you need to write SVG out, walk the tree and emit XML yourself; `attrs` preserves arbitrary attributes you didn't model.

## Next

- [Path support](/features/paths)
- [Paint servers](/features/paint-servers)
- [Transforms](/features/transforms)
