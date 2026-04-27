/**
 * Paint server resolution: turn a `fill="url(#id)"` reference + the
 * referenced gradient definition into a sample-able paint that the
 * rasterizer can evaluate per pixel.
 */

import type { Matrix, RGBA, SVGGradient, SVGGradientStop, SVGLinearGradient, SVGRadialGradient } from './types'
import { applyMatrix, invertMatrix } from './transform'

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
 * Build a sample-able paint function for a radial gradient.
 *
 * The gradient parameter `t` for a pixel `P` is the ratio along the ray
 * `F → P` of the distance from `F` (the focal point) to `P`, divided by
 * the distance from `F` to where that ray exits the gradient circle
 * (centre `C`, radius `r`). This matches the SVG 1.1 spec.
 */
export function buildRadialGradientPaint(g: SVGRadialGradient, ctx: PaintContext): { sample: (x: number, y: number) => RGBA } {
  let cx = g.cx, cy = g.cy, r = g.r, fx = g.fx, fy = g.fy
  if (g.units === 'objectBoundingBox') {
    cx = ctx.bbox.x + ctx.bbox.width * g.cx
    cy = ctx.bbox.y + ctx.bbox.height * g.cy
    // Per SVG spec, in objectBoundingBox the unit square maps onto the
    // bbox; a circle of radius `g.r` in unit space therefore covers
    // `g.r * sqrt(w² + h²) / sqrt(2)` in user space (the bbox diagonal
    // scaled by g.r so r=0.5 fits a centred circle through the corners).
    r = g.r * Math.hypot(ctx.bbox.width, ctx.bbox.height) / Math.SQRT2
    fx = ctx.bbox.x + ctx.bbox.width * g.fx
    fy = ctx.bbox.y + ctx.bbox.height * g.fy
  }
  // Sampling in untransformed gradient space — invert gradientTransform.
  const txm: Matrix | null = g.gradientTransform ? invertMatrix(g.gradientTransform) : null

  if (r === 0) {
    const c = g.stops[g.stops.length - 1]?.color ?? { r: 0, g: 0, b: 0, a: 0 }
    return { sample: () => c }
  }

  // Per SVG 1.1 §15.17.2: if the focal point lies outside (or on) the
  // gradient circle, clamp it onto the circle. We back the clamp inward by
  // a single ULP so the ray-circle intersection is well-defined for all
  // pixels (a focal point exactly on the boundary makes the discriminant
  // zero on the focal ray, producing a degenerate gradient).
  const fdx0 = fx - cx, fdy0 = fy - cy
  const fdist = Math.hypot(fdx0, fdy0)
  if (fdist >= r) {
    const k = (r * (1 - Number.EPSILON * 64)) / fdist
    fx = cx + fdx0 * k
    fy = cy + fdy0 * k
  }
  const fxc = fx - cx, fyc = fy - cy
  const r2 = r * r

  return {
    sample: (px, py) => {
      let [ux, uy] = applyMatrix(ctx.devToUser, px, py)
      if (txm) [ux, uy] = applyMatrix(txm, ux, uy)
      // Intersect the ray F→P with the circle of radius r around C.
      // Parametrise as Q(t) = F + t * (P - F); solve |Q - C|² = r².
      const dx = ux - fx, dy = uy - fy
      const a = dx * dx + dy * dy
      if (a === 0) return evalStops(g.stops, applySpread(0, g.spreadMethod))
      const b = dx * fxc + dy * fyc
      const c = fxc * fxc + fyc * fyc - r2
      const disc = b * b - a * c
      if (disc < 0) {
        // Shouldn't happen after clamping, but guard.
        return evalStops(g.stops, applySpread(1, g.spreadMethod))
      }
      // Take the positive root (forward along F→P direction).
      const sqrtD = Math.sqrt(disc)
      const tExit = (-b + sqrtD) / a
      const t = tExit > 0 ? 1 / tExit : 0
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

