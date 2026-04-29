/**
 * Paint server resolution: turn a `fill="url(#id)"` reference + the
 * referenced gradient definition into a sample-able paint that the
 * rasterizer can evaluate per pixel.
 */

import type { Matrix, RGBA, SVGGradient, SVGGradientStop, SVGLinearGradient, SVGRadialGradient } from './types'
import { invertMatrix } from './transform'

/** Match a `fill: url(#id)` / `fill: url("#id")` reference. */
const URL_REF_RE = /^url\(["']?#([^"')]+)["']?\)\s*$/

export function parseUrlRef(value: string | undefined | null): string | null {
  if (!value) return null
  // Cheap rejection — `url(` is 4 chars, anything starting with something
  // else cannot match. Saves the trim+regex on the hot per-element path.
  // Allow leading whitespace (rare but legal).
  let i = 0
  const len = value.length
  while (i < len) {
    const c = value.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) i++
    else break
  }
  if (i >= len) return null
  if (value.charCodeAt(i) !== 117 /* u */) return null
  if (i + 4 >= len) return null
  if (value.charCodeAt(i + 1) !== 114 /* r */) return null
  if (value.charCodeAt(i + 2) !== 108 /* l */) return null
  if (value.charCodeAt(i + 3) !== 40 /* ( */) return null
  const m = value.match(URL_REF_RE)
  return m ? m[1]! : null
}

/** Evaluate a stop list at parameter `t` and write into the supplied scratch RGBA. */
function evalStopsInto(stops: SVGGradientStop[], t: number, out: RGBA): void {
  const n = stops.length
  if (n === 0) { out.r = 0; out.g = 0; out.b = 0; out.a = 0; return }
  if (n === 1) {
    const c = stops[0]!.color
    out.r = c.r; out.g = c.g; out.b = c.b; out.a = c.a
    return
  }
  // Linear search — typical gradients have 2-4 stops, beating binary search.
  let lo = 0
  while (lo + 1 < n && stops[lo + 1]!.offset < t) lo++
  const a = stops[lo]!
  const b = lo + 1 < n ? stops[lo + 1]! : a
  if (a === b) {
    const c = a.color
    out.r = c.r; out.g = c.g; out.b = c.b; out.a = c.a
    return
  }
  const span = b.offset - a.offset
  let u = span === 0 ? 0 : (t - a.offset) / span
  if (u < 0) u = 0
  else if (u > 1) u = 1
  const v = 1 - u
  const ca = a.color, cb = b.color
  out.r = (ca.r * v + cb.r * u + 0.5) | 0
  out.g = (ca.g * v + cb.g * u + 0.5) | 0
  out.b = (ca.b * v + cb.b * u + 0.5) | 0
  out.a = (ca.a * v + cb.a * u + 0.5) | 0
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
 *
 * Per-pixel hot path:
 *  - `applyMatrix` is inlined (saves a 2-element tuple alloc per pixel)
 *  - the returned RGBA is a single scratch object filled in place per call
 *    (callers consume it before calling sample again — matching how
 *    fillPolygons reads it). Saves N×fb-pixels of `{r,g,b,a}` allocations
 *    for a single-shape fill.
 */
export function buildLinearGradientPaint(g: SVGLinearGradient, ctx: PaintContext): { sample: (x: number, y: number) => RGBA } {
  let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2
  if (g.units === 'objectBoundingBox') {
    x1 = ctx.bbox.x + ctx.bbox.width * g.x1
    y1 = ctx.bbox.y + ctx.bbox.height * g.y1
    x2 = ctx.bbox.x + ctx.bbox.width * g.x2
    y2 = ctx.bbox.y + ctx.bbox.height * g.y2
  }
  if (g.gradientTransform) {
    const m = g.gradientTransform
    const nx1 = m[0] * x1 + m[2] * y1 + m[4]
    const ny1 = m[1] * x1 + m[3] * y1 + m[5]
    const nx2 = m[0] * x2 + m[2] * y2 + m[4]
    const ny2 = m[1] * x2 + m[3] * y2 + m[5]
    x1 = nx1; y1 = ny1; x2 = nx2; y2 = ny2
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const c = g.stops[g.stops.length - 1]?.color ?? { r: 0, g: 0, b: 0, a: 0 }
    return { sample: () => c }
  }
  const invLenSq = 1 / lenSq
  const stops = g.stops
  const spread = g.spreadMethod
  const dtu = ctx.devToUser
  const m0 = dtu[0], m1 = dtu[1], m2 = dtu[2], m3 = dtu[3], m4 = dtu[4], m5 = dtu[5]
  const scratch: RGBA = { r: 0, g: 0, b: 0, a: 0 }
  return {
    sample: (px, py) => {
      const ux = m0 * px + m2 * py + m4
      const uy = m1 * px + m3 * py + m5
      const t = ((ux - x1) * dx + (uy - y1) * dy) * invLenSq
      evalStopsInto(stops, applySpread(t, spread), scratch)
      return scratch
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

  const stops = g.stops
  const spread = g.spreadMethod
  const dtu = ctx.devToUser
  const dm0 = dtu[0], dm1 = dtu[1], dm2 = dtu[2], dm3 = dtu[3], dm4 = dtu[4], dm5 = dtu[5]
  const tm0 = txm ? txm[0] : 0, tm1 = txm ? txm[1] : 0, tm2 = txm ? txm[2] : 0
  const tm3 = txm ? txm[3] : 0, tm4 = txm ? txm[4] : 0, tm5 = txm ? txm[5] : 0
  const scratch: RGBA = { r: 0, g: 0, b: 0, a: 0 }
  return {
    sample: (px, py) => {
      let ux = dm0 * px + dm2 * py + dm4
      let uy = dm1 * px + dm3 * py + dm5
      if (txm) {
        const nx = tm0 * ux + tm2 * uy + tm4
        const ny = tm1 * ux + tm3 * uy + tm5
        ux = nx; uy = ny
      }
      const dx = ux - fx, dy = uy - fy
      const a = dx * dx + dy * dy
      if (a === 0) {
        evalStopsInto(stops, applySpread(0, spread), scratch)
        return scratch
      }
      const b = dx * fxc + dy * fyc
      const c = fxc * fxc + fyc * fyc - r2
      const disc = b * b - a * c
      if (disc < 0) {
        evalStopsInto(stops, applySpread(1, spread), scratch)
        return scratch
      }
      const sqrtD = Math.sqrt(disc)
      const tExit = (-b + sqrtD) / a
      const t = tExit > 0 ? 1 / tExit : 0
      evalStopsInto(stops, applySpread(t, spread), scratch)
      return scratch
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

