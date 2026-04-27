# Strokes

ts-svg implements the full SVG stroke model — joins, caps, dashes, miter limits — and applies it uniformly to `<path>`, `<polygon>`, `<polyline>`, `<line>`, `<rect>`, `<circle>`, and `<ellipse>`.

## Stroke style fields

These are read from the element directly, with the usual cascade through `<g>` parents:

```ts
interface BaseNode {
  stroke?: string | null
  strokeWidth?: number
  strokeLineCap?: 'butt' | 'round' | 'square'
  strokeLineJoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDashArray?: number[]
  strokeDashOffset?: number
  strokeOpacity?: number
  vectorEffect?: 'none' | 'non-scaling-stroke'
}
```

Defaults match the SVG spec:

| Attribute | Default |
| --- | --- |
| `stroke` | `none` (no stroke) |
| `stroke-width` | `1` |
| `stroke-linecap` | `butt` |
| `stroke-linejoin` | `miter` |
| `stroke-miterlimit` | `4` |
| `stroke-dasharray` | `none` (solid line) |
| `stroke-dashoffset` | `0` |

## Caps

The end-of-line cap shape:

| `linecap` | What it draws |
| --- | --- |
| `butt` | Flush square end at the path endpoint. |
| `round` | Half-circle of radius `strokeWidth/2` past the endpoint. |
| `square` | Square that extends `strokeWidth/2` past the endpoint. |

Applied to every open sub-path's two ends. Closed sub-paths (path data ending in `Z`) get a join at their close point instead of a cap.

## Joins

The corner shape between two segments:

| `linejoin` | What it draws |
| --- | --- |
| `miter` | Sharp corner. Falls back to `bevel` if the corner exceeds `stroke-miterlimit`. |
| `round` | Filled arc of radius `strokeWidth/2` covering the corner. |
| `bevel` | Flat chamfer between the two segment ends. |

`stroke-miterlimit` is the *ratio* of miter length to stroke width — the SVG default is `4`, meaning a join that would extend more than 4 × `strokeWidth` past the corner is bevelled instead.

## Dashes

`stroke-dasharray` takes a list of alternating dash and gap lengths in user units:

```svg
<line x1="0" y1="0" x2="100" y2="0"
      stroke="black" stroke-width="4"
      stroke-dasharray="10 5" />
<!-- 10px dash, 5px gap, 10px dash, 5px gap, … -->
```

If the array has an odd number of values, it's repeated to make the count even (`5 3 1` → `5 3 1 5 3 1`). `stroke-dashoffset` shifts the starting point along the dash pattern — useful for "dash march" animations or for aligning a dashed stroke against a tick grid.

```svg
<rect width="200" height="100" fill="none" stroke="black"
      stroke-dasharray="6 4" stroke-dashoffset="3" />
```

Dashes flow continuously across joins on the same sub-path; each sub-path resets the dash state.

## Vector effect

```svg
<path stroke="black" stroke-width="2"
      vector-effect="non-scaling-stroke" d="…" />
```

By default a stroke scales with the surrounding transform — render at 2× and the stroke is twice as thick. `vector-effect="non-scaling-stroke"` undoes that: the stroke width is interpreted in *device* pixels, so it's exactly `strokeWidth` thick at any zoom.

This is the right setting for UI overlays on a zoomable map, schematic diagrams, or any stroke that should remain crisp regardless of the viewport.

## Stroke opacity vs `opacity`

`stroke-opacity` only affects the stroke. `opacity` affects fill *and* stroke (it's applied as a final group composite). If you want a thin element with a translucent stroke and an opaque fill, set `stroke-opacity`, not `opacity`.

## What's not supported

- `<marker>` rendering. The marker definition parses; no marker glyphs are drawn.
- Non-uniform scaling caps (e.g. an elliptical stroke from a non-uniform parent transform). Caps are always isotropic — close enough for icons; not what you want for technical illustration.

If you need either of these, file an issue with a sample SVG.
