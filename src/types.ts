/**
 * Element-tree representation of an SVG document.
 *
 * The parser produces this tree; the renderer consumes it. Each node is
 * typed by its `tag`, with the attributes the renderer cares about pulled
 * out into typed fields and arbitrary other attributes preserved on
 * `attrs` (used by the style cascade).
 */

export type StrokeLineCap = 'butt' | 'round' | 'square'
export type StrokeLineJoin = 'miter' | 'round' | 'bevel'

export interface BaseNode {
  attrs: Record<string, string>
  /** Inherited / element-level fill (CSS string, `url(#id)` for paint servers, or null = none). */
  fill?: string | null
  /** Inherited / element-level stroke. */
  stroke?: string | null
  strokeWidth?: number
  strokeLineCap?: StrokeLineCap
  strokeLineJoin?: StrokeLineJoin
  /** Miter limit ratio (default 4 per SVG spec). */
  strokeMiterLimit?: number
  /** Dash array in user units (alternating dash, gap). Empty array or unset = solid. */
  strokeDashArray?: number[]
  /** Phase offset into the dash array. */
  strokeDashOffset?: number
  fillOpacity?: number
  strokeOpacity?: number
  opacity?: number
  /** Optional element transform (`transform="..."`). */
  transform?: Matrix
  /** clip-path attribute (e.g. `url(#myClip)`). */
  clipPath?: string
  /** mask attribute (e.g. `url(#myMask)`). */
  mask?: string
}

/**
 * SVG `preserveAspectRatio` value. `align` controls where the viewBox is
 * positioned within the viewport when the aspect ratios don't match;
 * `meetOrSlice` controls whether to fit ('meet') or fill ('slice').
 */
export interface PreserveAspectRatio {
  align: 'none' | 'xMinYMin' | 'xMidYMin' | 'xMaxYMin'
    | 'xMinYMid' | 'xMidYMid' | 'xMaxYMid'
    | 'xMinYMax' | 'xMidYMax' | 'xMaxYMax'
  meetOrSlice: 'meet' | 'slice'
}

export interface SVGRoot extends BaseNode {
  tag: 'svg'
  width: number
  height: number
  viewBox?: { x: number, y: number, width: number, height: number }
  /** Defaults to `xMidYMid meet` per SVG spec. */
  preserveAspectRatio: PreserveAspectRatio
  children: SVGNode[]
  /** Definitions registry (gradients, clipPaths, masks, id-keyed elements). */
  defs: SVGDefs
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

export interface SVGText extends BaseNode {
  tag: 'text'
  x: number
  y: number
  /** Anchor: start (default) | middle | end. */
  textAnchor: 'start' | 'middle' | 'end'
  /** font-family CSS value (first match wins via FontResolver). */
  fontFamily: string
  fontSize: number
  /** Inner text content (whitespace-collapsed). */
  text: string
}

/** ----- Paint server / clip / mask references ----- */

export interface SVGGradientStop {
  /** 0..1 stop offset along the gradient. */
  offset: number
  color: RGBA
}

export interface SVGLinearGradient extends BaseNode {
  tag: 'linearGradient'
  id: string
  x1: number; y1: number; x2: number; y2: number
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  spreadMethod: 'pad' | 'reflect' | 'repeat'
  stops: SVGGradientStop[]
  gradientTransform?: Matrix
}

export interface SVGRadialGradient extends BaseNode {
  tag: 'radialGradient'
  id: string
  cx: number; cy: number; r: number
  /** Focal point (defaults to centre). */
  fx: number; fy: number
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  spreadMethod: 'pad' | 'reflect' | 'repeat'
  stops: SVGGradientStop[]
  gradientTransform?: Matrix
}

export type SVGGradient = SVGLinearGradient | SVGRadialGradient

export interface SVGClipPath {
  tag: 'clipPath'
  id: string
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  children: SVGNode[]
  attrs: Record<string, string>
}

export interface SVGMask {
  tag: 'mask'
  id: string
  /** maskUnits (default userSpaceOnUse). */
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  /** maskContentUnits (default userSpaceOnUse). */
  contentUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  /** SVG2 `mask-type`: how mask content modulates target alpha. */
  maskType: 'luminance' | 'alpha'
  x?: number; y?: number; width?: number; height?: number
  children: SVGNode[]
  attrs: Record<string, string>
}

export interface SVGUse extends BaseNode {
  tag: 'use'
  href: string
  x: number
  y: number
  width?: number
  height?: number
}

/** A registry of `id`-bearing definitions found while parsing. */
export interface SVGDefs {
  gradients: Map<string, SVGGradient>
  clipPaths: Map<string, SVGClipPath>
  masks: Map<string, SVGMask>
  /** Any other id-bearing element (used for `<use>` references). */
  byId: Map<string, SVGNode>
}

export type SVGElementNode = SVGRect | SVGCircle | SVGEllipse | SVGLine | SVGPolygon | SVGPath | SVGText | SVGUse
export type SVGNode = SVGRoot | SVGGroup | SVGElementNode

/**
 * Function the renderer calls to resolve a `<text>` element's font.
 * Return `null` to skip rendering.
 *
 * The returned object must implement the minimum surface ts-svg uses:
 *   - `getPath(text, x, y, fontSize)` → produces an SVG path-data string
 *     OR a Path-like object with a `toPathData()` method.
 *   - `getAdvanceWidth(text, fontSize)` → number, for text-anchor alignment.
 */
export interface ResolvedFont {
  getPath: (text: string, x: number, y: number, fontSize: number) => { toPathData: (decimals?: number) => string }
  getAdvanceWidth: (text: string, fontSize: number) => number
}

// eslint-disable-next-line pickier/no-unused-vars
export type FontResolver = (familyList: string, sizeHint: number) => ResolvedFont | null

/** 2x3 affine: [a, b, c, d, tx, ty] applied as (x', y') = (a*x + c*y + tx, b*x + d*y + ty). */
export type Matrix = readonly [number, number, number, number, number, number]

/** RGBA in [0..255]. */
export interface RGBA { r: number, g: number, b: number, a: number }
