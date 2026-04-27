/**
 * Paint server resolution: turn a `fill="url(#id)"` reference + the
 * referenced gradient definition into a sample-able paint that the
 * rasterizer can evaluate per pixel.
 */

import type { Matrix, RGBA, SVGGradient, SVGGradientStop, SVGLinearGradient, SVGRadialGradient } from './types'
import { multiply } from './transform'

/** Match a `fill: url(#id)` / `fill: url("#id")` reference. */
const URL_REF_RE = /^url\(["']?#([^"')]+)["']?\)\s*$/

export function parseUrlRef(value: string | undefined | null): string | null {
  if (!value) return null
  const m = value.trim().match(URL_REF_RE)
  return m ? m[1]! : null
}

/** Linearly interpolate two RGBA colours (premultiplied alpha). */
function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  const u = 1 - t
  return {
    r: Math.round(a.r * u + b.r * t),
    g: Math.round(a.g * u + b.g * t),
    b: Math.round(a.b * u + b.b * t),
    a: Math.round(a.a * u + b.a * t),
  }
}

/** Evaluate a stop list at parameter `t` (already clamped/wrapped). */
function evalStops(stops: SVGGradientStop[], t: number): RGBA {
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 }
  if (stops.length === 1) return stops[0]!.color
  // Find bracket
  let lo = 0
  while (lo + 1 < stops.length && stops[lo + 1]!.offset < t) lo++
  const a = stops[lo]!
  const b = stops[Math.min(lo + 1, stops.length - 1)]!
  if (a === b) return a.color
  const span = b.offset - a.offset
  const u = span === 0 ? 0 : (t - a.offset) / span
  return lerpColor(a.color, b.color, Math.max(0, Math.min(1, u)))
}

/** Apply spreadMethod to a raw t value (may be outside [0,1]). */
function applySpread(t: number, spread: SVGGradient['spreadMethod']): number {
  if (t >= 0 && t <= 1) return t
  if (spread === 'pad') return Math.max(0, Math.min(1, t))
  if (spread === 'repeat') {
    const r = t - Math.floor(t)
    return r
  }
  // reflect
  const period = 2
  let r = t - Math.floor(t / period) * period
  if (r > 1) r = period - r
  return r
}

/** Invert a 2x3 affine. Returns null if singular. */
function invertMatrix(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  const tx = (m[2] * m[5] - m[3] * m[4]) / det
  const ty = (m[1] * m[4] - m[0] * m[5]) / det
  return [a, b, c, d, tx, ty]
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export interface PaintContext {
  /** Element bounding box in user space, used for objectBoundingBox gradients. */
  bbox: { x: number, y: number, width: number, height: number }
  /** Device-space → user-space inverse, so per-pixel sampling can map back. */
  devToUser: Matrix
}

/**
 * Build a sample-able paint function for a linear gradient. Takes device
 * pixel coords (x,y) and returns the gradient-evaluated colour.
 */
export function buildLinearGradientPaint(g: SVGLinearGradient, ctx: PaintContext): { sample: (x: number, y: number) => RGBA } {
  // Resolve gradient axis in user space.
  let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2
  if (g.units === 'objectBoundingBox') {
    x1 = ctx.bbox.x + ctx.bbox.width * g.x1
    y1 = ctx.bbox.y + ctx.bbox.height * g.y1
    x2 = ctx.bbox.x + ctx.bbox.width * g.x2
    y2 = ctx.bbox.y + ctx.bbox.height * g.y2
  }
  // Apply gradientTransform (in user space).
  if (g.gradientTransform) {
    [x1, y1] = applyMatrix(g.gradientTransform, x1, y1)
    ;[x2, y2] = applyMatrix(g.gradientTransform, x2, y2)
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const c = g.stops[g.stops.length - 1]?.color ?? { r: 0, g: 0, b: 0, a: 0 }
    return { sample: () => c }
  }
  return {
    sample: (px, py) => {
      const [ux, uy] = applyMatrix(ctx.devToUser, px, py)
      const t = ((ux - x1) * dx + (uy - y1) * dy) / lenSq
      return evalStops(g.stops, applySpread(t, g.spreadMethod))
    },
  }
}

/**
 * Build a sample-able paint function for a radial gradient. Honours focal
 * point (fx, fy) — the gradient parameter is the ratio of the pixel's
 * distance from the focal point along the line through the center.
 */
export function buildRadialGradientPaint(g: SVGRadialGradient, ctx: PaintContext): { sample: (x: number, y: number) => RGBA } {
  let cx = g.cx, cy = g.cy, r = g.r, fx = g.fx, fy = g.fy
  if (g.units === 'objectBoundingBox') {
    cx = ctx.bbox.x + ctx.bbox.width * g.cx
    cy = ctx.bbox.y + ctx.bbox.height * g.cy
    r = Math.max(ctx.bbox.width, ctx.bbox.height) * g.r
    fx = ctx.bbox.x + ctx.bbox.width * g.fx
    fy = ctx.bbox.y + ctx.bbox.height * g.fy
  }
  let txm: Matrix | null = g.gradientTransform ? invertMatrix(g.gradientTransform) : null
  if (g.gradientTransform && !txm) txm = null
  // We invert the gradientTransform so we can sample in untransformed gradient
  // space (which is where cx/cy/r live).

  if (r === 0) {
    const c = g.stops[g.stops.length - 1]?.color ?? { r: 0, g: 0, b: 0, a: 0 }
    return { sample: () => c }
  }

  return {
    sample: (px, py) => {
      let [ux, uy] = applyMatrix(ctx.devToUser, px, py)
      if (txm) [ux, uy] = applyMatrix(txm, ux, uy)
      // For non-coincident focal, the gradient parameter is computed by
      // intersecting the ray (focal → pixel) with the bounding circle.
      // For simplicity we use the standard centre-based normalisation here
      // (focal handling is approximate but visually close for small offsets).
      const dx = ux - cx, dy = uy - cy
      const d = Math.hypot(dx, dy)
      let t = d / r
      if (fx !== cx || fy !== cy) {
        // Adjust by the focal-point offset along the same direction.
        const fDx = fx - cx, fDy = fy - cy
        const dot = dx * fDx + dy * fDy
        const offset = d > 0 ? dot / d : 0
        t = (d - offset) / Math.max(1e-9, r - offset)
      }
      return evalStops(g.stops, applySpread(t, g.spreadMethod))
    },
  }
}

export function buildGradientPaint(g: SVGGradient, ctx: PaintContext): { sample: (x: number, y: number) => RGBA } {
  if (g.tag === 'linearGradient') return buildLinearGradientPaint(g, ctx)
  return buildRadialGradientPaint(g, ctx)
}

/** Compute the bounding box of a set of polygons (user space). */
export function polysBBox(polys: number[][]): { x: number, y: number, width: number, height: number } {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const p of polys) {
    for (let i = 0; i < p.length; i += 2) {
      if (p[i]! < xMin) xMin = p[i]!
      if (p[i]! > xMax) xMax = p[i]!
      if (p[i + 1]! < yMin) yMin = p[i + 1]!
      if (p[i + 1]! > yMax) yMax = p[i + 1]!
    }
  }
  if (!Number.isFinite(xMin)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin }
}

// re-export for the renderer
export { multiply }
