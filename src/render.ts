/**
 * Walk an SVG element tree, flatten every shape into polygons, and
 * rasterise into an RGBA framebuffer.
 */

import type { BaseNode, Matrix, RGBA, SVGCircle, SVGElementNode, SVGEllipse, SVGLine, SVGNode, SVGPath, SVGPolygon, SVGRect, SVGRoot } from './types'
import { parseColor } from './color'
import { flattenCommands, parsePath } from './path'
import { createFramebuffer, fillPolygons, strokePolylines, type Framebuffer } from './raster'
import { applyMatrix, IDENTITY, multiply } from './transform'

export interface RenderOptions {
  /** Output width in pixels. Overrides the SVG's intrinsic width. */
  width?: number
  /** Output height in pixels. */
  height?: number
  /** Multiplier on the SVG's intrinsic size. Ignored if width/height are set. */
  scale?: number
  /** Background colour (CSS string or RGBA). Defaults to transparent. */
  background?: string | RGBA
  /** Bezier flattening tolerance in user-space units. Default 0.25 px. */
  tolerance?: number
}

interface RenderCtx {
  fb: Framebuffer
  /** SVG-user-space → device-pixel transform (composed with element transforms). */
  rootTransform: Matrix
  tolerance: number
}

interface InheritedStyle {
  fill: RGBA | null
  stroke: RGBA | null
  strokeWidth: number
  opacity: number
  fillOpacity: number
  strokeOpacity: number
  transform: Matrix
}

function inheritStyle(parent: InheritedStyle, node: BaseNode): InheritedStyle {
  const out: InheritedStyle = {
    fill: parent.fill,
    stroke: parent.stroke,
    strokeWidth: parent.strokeWidth,
    opacity: parent.opacity,
    fillOpacity: parent.fillOpacity,
    strokeOpacity: parent.strokeOpacity,
    transform: parent.transform,
  }
  if (node.fill === null) out.fill = null
  else if (node.fill !== undefined) out.fill = parseColor(node.fill)
  if (node.stroke === null) out.stroke = null
  else if (node.stroke !== undefined) out.stroke = parseColor(node.stroke)
  if (node.strokeWidth != null) out.strokeWidth = node.strokeWidth
  if (node.opacity != null) out.opacity = node.opacity
  if (node.fillOpacity != null) out.fillOpacity = node.fillOpacity
  if (node.strokeOpacity != null) out.strokeOpacity = node.strokeOpacity
  if (node.transform) out.transform = multiply(parent.transform, node.transform)
  return out
}

function effectiveFill(s: InheritedStyle): RGBA | null {
  if (!s.fill) return null
  const opacity = s.opacity * s.fillOpacity
  if (opacity >= 1) return s.fill
  return { ...s.fill, a: Math.round(s.fill.a * opacity) }
}

function effectiveStroke(s: InheritedStyle): { color: RGBA, width: number } | null {
  if (!s.stroke) return null
  const opacity = s.opacity * s.strokeOpacity
  const a = Math.round(s.stroke.a * opacity)
  if (a === 0) return null
  return { color: { ...s.stroke, a }, width: s.strokeWidth }
}

/** Apply a 2x3 transform to a flat polygon `[x0, y0, x1, y1, ...]` in place
 *  (returns a new array). */
function transformPoly(poly: number[], m: Matrix): number[] {
  const out = Array.from({ length: poly.length }) as number[]
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i]!, y = poly[i + 1]!
    out[i] = m[0] * x + m[2] * y + m[4]
    out[i + 1] = m[1] * x + m[3] * y + m[5]
  }
  return out
}

// Shape-specific contour generators (in element-local user space).
function rectToPolys(r: SVGRect): number[][] {
  // Rounded corners not yet supported — flatten rx/ry to 0 for now.
  return [[
    r.x, r.y,
    r.x + r.width, r.y,
    r.x + r.width, r.y + r.height,
    r.x, r.y + r.height,
  ]]
}

function ellipseToPolys(cx: number, cy: number, rx: number, ry: number, tolerance: number): number[][] {
  // Approximate as a polygon with enough points to keep error below tolerance.
  // For a circle of radius r, n segments give max sagitta r*(1 - cos(pi/n)).
  const r = Math.max(rx, ry)
  const n = Math.max(16, Math.ceil(Math.PI / Math.acos(1 - tolerance / r)))
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  }
  return [pts]
}

function lineToPolys(_l: SVGLine): number[][] {
  // A bare line has no fill area; the renderer treats it as an empty fill
  // and a separate stroke pass.
  return []
}

function polygonToPolys(p: SVGPolygon): number[][] {
  if (p.points.length < 2) return []
  const flat: number[] = []
  for (const [x, y] of p.points) flat.push(x, y)
  return [flat]
}

function pathToPolys(p: SVGPath, tolerance: number): number[][] {
  const cmds = parsePath(p.d)
  return flattenCommands(cmds, tolerance)
}

function shapeToPolys(node: SVGElementNode, tolerance: number): number[][] {
  switch (node.tag) {
    case 'rect': return rectToPolys(node)
    case 'circle': return ellipseToPolys(node.cx, node.cy, node.r, node.r, tolerance)
    case 'ellipse': return ellipseToPolys(node.cx, node.cy, node.rx, node.ry, tolerance)
    case 'line': return lineToPolys(node)
    case 'polygon':
    case 'polyline': return polygonToPolys(node)
    case 'path': return pathToPolys(node, tolerance)
  }
}

/** Extract a stroke polyline (as polylines, not closed polygons) from a shape. */
function shapeToPolylines(node: SVGElementNode, tolerance: number): { polys: number[][], closed: boolean } {
  switch (node.tag) {
    case 'line': return { polys: [[node.x1, node.y1, node.x2, node.y2]], closed: false }
    case 'polygon': return { polys: polygonToPolys(node), closed: true }
    case 'polyline': return { polys: polygonToPolys(node), closed: false }
    default: return { polys: shapeToPolys(node, tolerance), closed: true }
  }
}

function renderNode(node: SVGNode, parentStyle: InheritedStyle, ctx: RenderCtx): void {
  const style = inheritStyle(parentStyle, node)

  if (node.tag === 'svg' || node.tag === 'g') {
    for (const c of node.children) renderNode(c, style, ctx)
    return
  }

  // Shape: produce polygons in user-space, transform to device, then fill/stroke.
  const userPolys = shapeToPolys(node as SVGElementNode, ctx.tolerance)
  const finalT = multiply(ctx.rootTransform, style.transform)
  const fillColor = effectiveFill(style)
  if (fillColor && userPolys.length > 0) {
    const devPolys = userPolys.map(p => transformPoly(p, finalT))
    fillPolygons(ctx.fb, devPolys, fillColor)
  }

  const strokeSpec = effectiveStroke(style)
  if (strokeSpec) {
    const lp = shapeToPolylines(node as SVGElementNode, ctx.tolerance)
    if (lp.polys.length > 0) {
      const devPolys = lp.polys.map(p => transformPoly(p, finalT))
      // Approximate stroke width transform as the average device scale.
      // This is exact for uniform scale; sufficient for skewed transforms.
      const sx = Math.hypot(finalT[0], finalT[1])
      const sy = Math.hypot(finalT[2], finalT[3])
      const scale = (sx + sy) / 2 || 1
      strokePolylines(ctx.fb, devPolys, strokeSpec.color, strokeSpec.width * scale, lp.closed)
    }
  }
}

/**
 * Rasterise an SVG element tree into a framebuffer.
 */
export function rasterize(root: SVGRoot, opts: RenderOptions = {}): Framebuffer {
  const intrinsicW = root.width || (root.viewBox?.width ?? 100)
  const intrinsicH = root.height || (root.viewBox?.height ?? 100)
  const scale = opts.scale ?? 1
  const width = Math.max(1, Math.round(opts.width ?? intrinsicW * scale))
  const height = Math.max(1, Math.round(opts.height ?? intrinsicH * scale))

  const bg = typeof opts.background === 'string'
    ? parseColor(opts.background)
    : opts.background ?? { r: 0, g: 0, b: 0, a: 0 }

  const fb = createFramebuffer(width, height, bg)

  // Root transform: SVG user space → device pixels.
  let root2dev: Matrix = IDENTITY
  if (root.viewBox) {
    const vb = root.viewBox
    const sx = width / vb.width
    const sy = height / vb.height
    // Translate to origin, scale to fit, then offset for non-zero viewBox origin.
    root2dev = [sx, 0, 0, sy, -vb.x * sx, -vb.y * sy]
  }
  else {
    const sx = width / intrinsicW
    const sy = height / intrinsicH
    root2dev = [sx, 0, 0, sy, 0, 0]
  }

  const ctx: RenderCtx = {
    fb,
    rootTransform: root2dev,
    tolerance: opts.tolerance ?? 0.25,
  }

  // Initial style: no fill default per SVG spec is `black` for filled shapes
  // (but SVG actually defaults fill to black for paths). For our purposes
  // we follow SVG: fill=black, stroke=none.
  const initialStyle: InheritedStyle = {
    fill: parseColor('black'),
    stroke: null,
    strokeWidth: 1,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    transform: IDENTITY,
  }

  renderNode(root, initialStyle, ctx)
  // Suppress unused-import warnings for type-only refs.
  void applyMatrix
  return fb
}

export type { Framebuffer } from './raster'
