/**
 * Element-tree representation of an SVG document.
 *
 * The parser produces this tree; the renderer consumes it. Each node is
 * typed by its `tag`, with the attributes the renderer cares about pulled
 * out into typed fields and arbitrary other attributes preserved on
 * `attrs` (used by the style cascade).
 */

export interface BaseNode {
  attrs: Record<string, string>
  /** Inherited / element-level fill colour (CSS-ish string). `null` = none. */
  fill?: string | null
  /** Inherited / element-level stroke colour. */
  stroke?: string | null
  strokeWidth?: number
  fillOpacity?: number
  strokeOpacity?: number
  opacity?: number
  /** Optional element transform (`transform="..."`). */
  transform?: Matrix
}

export interface SVGRoot extends BaseNode {
  tag: 'svg'
  width: number
  height: number
  viewBox?: { x: number, y: number, width: number, height: number }
  children: SVGNode[]
}

export interface SVGGroup extends BaseNode {
  tag: 'g'
  children: SVGNode[]
}

export interface SVGRect extends BaseNode {
  tag: 'rect'
  x: number
  y: number
  width: number
  height: number
  rx?: number
  ry?: number
}

export interface SVGCircle extends BaseNode {
  tag: 'circle'
  cx: number
  cy: number
  r: number
}

export interface SVGEllipse extends BaseNode {
  tag: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface SVGLine extends BaseNode {
  tag: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SVGPolygon extends BaseNode {
  tag: 'polygon' | 'polyline'
  points: Array<[number, number]>
  closed: boolean
}

export interface SVGPath extends BaseNode {
  tag: 'path'
  d: string
}

export type SVGElementNode = SVGRect | SVGCircle | SVGEllipse | SVGLine | SVGPolygon | SVGPath
export type SVGNode = SVGRoot | SVGGroup | SVGElementNode

/** 2x3 affine: [a, b, c, d, tx, ty] applied as (x', y') = (a*x + c*y + tx, b*x + d*y + ty). */
export type Matrix = readonly [number, number, number, number, number, number]

/** RGBA in [0..255]. */
export interface RGBA { r: number, g: number, b: number, a: number }
