# Paths

`<path d="…">` is the most expressive SVG element — `parsePath` accepts the full grammar:

```
M m  L l  H h  V v  C c  S s  Q q  T t  A a  Z z
```

Both absolute (uppercase) and relative (lowercase) variants. Smooth-cubic (`S`, `s`), smooth-quadratic (`T`, `t`), and arc (`A`, `a`) commands all resolve correctly relative to the previous segment.

## Parsing

```ts
import { parsePath, type PathCmd } from 'ts-svg'

const cmds = parsePath('M 10 10 L 90 10 L 90 90 Z')
// PathCmd[] — discriminated by `cmd` field
```

`PathCmd` is a discriminated union; each entry is the *resolved* (always absolute, always with a complete coordinate set) form of a single command. You don't need to track current-point state yourself.

## Flattening

Curves and arcs are turned into polygons by the renderer; you can do it explicitly too:

```ts
import { flattenCommands } from 'ts-svg'

const contours = flattenCommands(cmds, /* tolerance */ 0.25)
// FlatContour[] — each contour is { points, closed }
```

The `tolerance` parameter (in user units) is the maximum allowed distance between the original curve and its polyline approximation. Smaller = smoother and more vertices. The renderer's default is `0.25 px`, tuned for `scale: 1`.

For ad-hoc curve work, the lower-level helpers are exposed too:

```ts
import { flattenCubic, flattenQuadratic, arcToCubics } from 'ts-svg'
```

`arcToCubics` converts an SVG elliptical arc command into a sequence of cubic Béziers — useful if you want to feed a path into another rendering library that doesn't speak SVG arcs.

## Fill rule

The default is `nonzero`. `fill-rule="evenodd"` flips the parity test, which is what you want for paths that intersect themselves (think the inside of a five-pointed star outlined in one continuous path):

```svg
<path fill-rule="evenodd" d="M ..." />
```

The setting cascades from parent groups, like every other fill attribute.

## Strokes on paths

Path strokes go through the same expansion as polygon strokes — see [Strokes](/features/strokes) for join / cap / dash control. Path-specific notes:

- Closed sub-paths (ending in `Z`) get a clean join at the close point.
- Open sub-paths get the configured `stroke-linecap` at each end.
- A path with multiple sub-paths (multiple `M` commands) is stroked as multiple polylines, each with its own caps.

## Bounds

Path bounds are computed from the flattened polylines, not the curve control points. That means the reported bounding box matches the visible ink to within the flattening tolerance — useful when you're laying out a generated SVG against fixed rectangles.

## Common patterns

### Round-trip a path through the parser

```ts
import { parsePath } from 'ts-svg'

const cmds = parsePath('M 0 0 c 10 0 20 10 20 20 z')
// cmds[1].cmd === 'C' (resolved to absolute) — not 'c'
// cmds[1].x === 20, .y === 20 (absolute end-point)
```

The resolved form is easier to reason about; if you need the original string, keep it separately.

### Approximate a curve as a polyline yourself

```ts
import { parsePath, flattenCommands } from 'ts-svg'

const polylines = flattenCommands(parsePath(d), 0.5)
  .map(contour => contour.points)
// polylines: Array<Array<[number, number]>>
```

Drop these into your favourite plotting / GIS / CAD library — no SVG-specific knowledge required downstream.

## Limits

- No `<marker>` rendering yet. The marker references parse fine, the markers themselves are skipped.
- No path morphing helpers (interpolation between two `d` strings). Use a dedicated library if you need this; ts-svg is a renderer, not an animation toolkit.
