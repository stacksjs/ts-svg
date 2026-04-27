# `<use>` references

`<use href="#id">` instantiates another element in place. ts-svg resolves these at render time against `SVGRoot.defs.byId`, so the parsed tree stays compact and you can mutate the source element to update every instance at once.

## Parsed shape

```ts
interface SVGUse extends BaseNode {
  tag: 'use'
  href: string
  x: number
  y: number
  width?: number
  height?: number
}
```

`href` is the raw fragment identifier (`#shape`, `#foo`). `x` / `y` shift the instance in user space. `width` / `height` are honoured when the referenced element is itself an `<svg>` or `<symbol>` with a `viewBox`.

Both `href` and the legacy `xlink:href` are accepted — the parser normalises them.

## Example

```svg
<defs>
  <circle id="dot" r="3" fill="black" />
</defs>

<use href="#dot" x="10" y="10" />
<use href="#dot" x="20" y="10" />
<use href="#dot" x="30" y="10" />
```

Three black dots, one source. Mutate `#dot`'s `fill` and every instance updates.

## What can be referenced

Anything with an `id` attribute — `<rect>`, `<circle>`, `<path>`, `<g>`, `<svg>`, `<symbol>`, even another `<use>`. The renderer recursively expands the chain at draw time.

```svg
<g id="badge">
  <circle r="20" fill="#0ea5e9" />
  <text x="0" y="5" text-anchor="middle">★</text>
</g>

<use href="#badge" x="50"  y="50" />
<use href="#badge" x="150" y="50" />
```

The cascade composes correctly: presentation attributes on the `<use>` itself (e.g. `<use href="#badge" fill="red">`) override the source where SVG specifies they should.

## Cycles

`<use href="#a">` referencing something that eventually references `#a` again is a cycle. ts-svg handles it with a hard depth cap rather than full cycle detection — `maxUseDepth` (default `16`) is the maximum recursion depth allowed:

```ts
rasterize(root, { maxUseDepth: 8 })  // tighter cap
rasterize(root, { maxUseDepth: 0 })  // <use> can't reference another <use>
```

The default is generous enough for any real document and short enough to abort runaway recursion fast. When the cap is hit, the offending `<use>` is dropped and rendering continues.

## Programmatic patterns

### Generate a grid

```ts
import { parseSVG, rasterize, encodePng, type SVGUse } from 'ts-svg'

const root = parseSVG(svgWithDefSymbol)
for (let y = 0; y < 10; y++) {
  for (let x = 0; x < 10; x++) {
    const use: SVGUse = {
      tag: 'use',
      href: '#cell',
      x: x * 16,
      y: y * 16,
      attrs: {},
    }
    root.children.push(use)
  }
}
encodePng(rasterize(root))
```

You build a 100-cell sprite from one source shape without copying the geometry.

### Recolour every instance at once

```ts
const dot = root.defs.byId.get('dot')
if (dot && 'fill' in dot) dot.fill = '#ec4899'
// every <use href="#dot"> renders pink
```

## What's not supported

- External `<use>` references (`href="other.svg#id"`). All targets must live in the same document.
- `<symbol>` semantics for explicit `viewBox` cropping at the use site. The element parses; the cropping behaviour is best-effort.

For the common cases — sprites, repeated shapes, generated grids — `<use>` works as expected and is the cheapest way to keep a tree small.

## Where references live

```ts
const root = parseSVG(svg)
console.log([...root.defs.byId.keys()]) // ['dot', 'badge', 'cell', ...]
```

`byId` is the unified registry. It includes shapes, groups, gradients, clip-paths, masks — anything that had an `id` in the source. The renderer dispatches `<use>` lookups through it.
