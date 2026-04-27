/**
 * Polygon rasterizer with analytical anti-aliasing.
 *
 * The classic scanline algorithm with `samples`-per-pixel super-sampling.
 * We use 4 horizontal samples per pixel to compute fractional coverage —
 * for typeface glyphs at typical sizes this gives visually identical output
 * to a 16x oversampler at a fraction of the cost.
 *
 * Fill rule: non-zero winding (matches SVG default).
 */

import type { RGBA } from './types'

export interface Framebuffer {
  width: number
  height: number
  /** RGBA bytes, row-major, top-to-bottom. */
  data: Uint8Array
}

/** Sample-able paint source: either a solid colour or a per-pixel function. */
export type Paint = RGBA | { sample: (xDev: number, yDev: number) => RGBA }

function isSolid(p: Paint): p is RGBA {
  return typeof (p as { sample?: unknown }).sample !== 'function'
}

export function createFramebuffer(width: number, height: number, bg: RGBA): Framebuffer {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg.r; data[i + 1] = bg.g; data[i + 2] = bg.b; data[i + 3] = bg.a
  }
  return { width, height, data }
}

interface Edge {
  /** Top y (inclusive). */
  yTop: number
  /** Bottom y (exclusive). */
  yBot: number
  /** Current x (at yTop). */
  x: number
  /** Slope dx/dy. */
  dxdy: number
  /** +1 if going down (increasing y), -1 if going up (for non-zero winding). */
  winding: number
}

/** Build edges from a flat polygon `[x0, y0, x1, y1, ...]`. */
function polygonToEdges(poly: number[], yScale: number): Edge[] {
  const edges: Edge[] = []
  const n = poly.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = poly[i * 2]!, ay = poly[i * 2 + 1]! * yScale
    const bx = poly[j * 2]!, by = poly[j * 2 + 1]! * yScale
    if (ay === by) continue // horizontal — contributes nothing
    if (ay < by) {
      edges.push({
        yTop: ay,
        yBot: by,
        x: ax,
        dxdy: (bx - ax) / (by - ay),
        winding: 1,
      })
    }
    else {
      edges.push({
        yTop: by,
        yBot: ay,
        x: bx,
        dxdy: (ax - bx) / (ay - by),
        winding: -1,
      })
    }
  }
  return edges
}

/**
 * Composite an RGBA value over a single pixel of the framebuffer with the
 * given coverage in [0, 1].
 */
function blendPixel(fb: Framebuffer, x: number, y: number, color: RGBA, coverage: number): void {
  if (coverage <= 0) return
  if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return
  const idx = (y * fb.width + x) * 4
  const srcA = color.a * coverage / 255
  const dstA = fb.data[idx + 3]! / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA === 0) return
  fb.data[idx]     = Math.round((color.r * srcA + fb.data[idx]!     * dstA * (1 - srcA)) / outA)
  fb.data[idx + 1] = Math.round((color.g * srcA + fb.data[idx + 1]! * dstA * (1 - srcA)) / outA)
  fb.data[idx + 2] = Math.round((color.b * srcA + fb.data[idx + 2]! * dstA * (1 - srcA)) / outA)
  fb.data[idx + 3] = Math.round(outA * 255)
}

/**
 * Rasterise a set of polygons (multiple sub-paths) with non-zero fill rule
 * and analytical horizontal AA (4 sub-pixel samples per scanline).
 *
 * `polys` is an array of contours; each contour is a flat polyline
 * `[x0, y0, x1, y1, ...]` (closed implicitly via wrap).
 *
 * `paint` may be a solid `RGBA` colour or a `{ sample(x, y): RGBA }` source
 * (e.g. a gradient evaluated per pixel).
 */
export function fillPolygons(fb: Framebuffer, polys: number[][], paint: Paint): void {
  if (polys.length === 0) return
  if (isSolid(paint) && paint.a === 0) return

  const SAMPLES = 4
  const sampleW = 1 / SAMPLES

  // Build all edges in sub-pixel y-space.
  const allEdges: Edge[][] = []
  for (let s = 0; s < SAMPLES; s++) allEdges.push([])

  for (const poly of polys) {
    const e = polygonToEdges(poly, 1)
    for (const edge of e) {
      // Determine which sample lines this edge crosses.
      const yTopSub = Math.floor(edge.yTop * SAMPLES)
      const yBotSub = Math.ceil(edge.yBot * SAMPLES)
      for (let ys = yTopSub; ys < yBotSub; ys++) {
        const yReal = (ys + 0.5) / SAMPLES
        if (yReal < edge.yTop || yReal >= edge.yBot) continue
        const x = edge.x + edge.dxdy * (yReal - edge.yTop)
        // Bucket by sample-line index modulo SAMPLES (within the pixel row).
        const sampleIdx = ys % SAMPLES
        const targetRow = Math.floor(ys / SAMPLES)
        if (targetRow < 0 || targetRow >= fb.height) continue
        // Reuse Edge struct: store crossing as a "vertical edge" at scanline targetRow.
        // We'll instead collect crossings directly.
        allEdges[(sampleIdx + SAMPLES) % SAMPLES]!.push({
          yTop: targetRow, yBot: targetRow + 1, x, dxdy: 0, winding: edge.winding,
        })
      }
    }
  }

  // For each scanline (pixel row), we need crossings per sub-sample, then
  // we accumulate coverage per pixel from "inside" segments.
  // Group crossings by row.
  const crossingsByRow: Map<number, Array<{ x: number, w: number, sample: number }>> = new Map()
  for (let s = 0; s < SAMPLES; s++) {
    for (const e of allEdges[s]!) {
      let arr = crossingsByRow.get(e.yTop)
      if (!arr) { arr = []; crossingsByRow.set(e.yTop, arr) }
      arr.push({ x: e.x, w: e.winding, sample: s })
    }
  }

  for (const [row, raw] of crossingsByRow) {
    if (row < 0 || row >= fb.height) continue

    // Per-sample coverage stripes
    const stripes = new Map<number, Array<{ x: number, w: number }>>()
    for (const c of raw) {
      let arr = stripes.get(c.sample)
      if (!arr) { arr = []; stripes.set(c.sample, arr) }
      arr.push({ x: c.x, w: c.w })
    }

    // Accumulate per-pixel coverage.
    // For each sample line, walk its sorted crossings tracking winding,
    // and add `1/SAMPLES` to each pixel where winding != 0 weighted by
    // the fraction of the pixel between the two crossings.
    const pixCoverage = new Map<number, number>()
    for (const [, list] of stripes) {
      list.sort((a, b) => a.x - b.x)
      let winding = 0
      let prev = 0
      let prevInside = false
      for (const c of list) {
        if (prevInside) {
          const a = Math.max(0, prev)
          const b = Math.min(fb.width, c.x)
          if (b > a) {
            // Distribute coverage across pixel columns.
            const xa = Math.floor(a)
            const xb = Math.floor(b)
            for (let px = xa; px <= xb; px++) {
              const segL = Math.max(a, px)
              const segR = Math.min(b, px + 1)
              if (segR > segL) {
                pixCoverage.set(px, (pixCoverage.get(px) ?? 0) + (segR - segL) * sampleW)
              }
            }
          }
        }
        winding += c.w
        prevInside = winding !== 0
        prev = c.x
      }
    }

    for (const [px, cov] of pixCoverage) {
      const c = isSolid(paint) ? paint : paint.sample(px + 0.5, row + 0.5)
      blendPixel(fb, px, row, c, Math.min(1, cov))
    }
  }
}

/**
 * Stroke styling options. Defaults match the SVG spec.
 */
export interface StrokeStyle {
  width: number
  cap: 'butt' | 'round' | 'square'
  join: 'miter' | 'round' | 'bevel'
  /** Miter-limit ratio: above this, miters fall back to bevel. */
  miterLimit: number
  /** Dash array in user units; empty = solid. */
  dashArray: number[]
  /** Phase offset into the dash pattern. */
  dashOffset: number
}

export const DEFAULT_STROKE: StrokeStyle = {
  width: 1,
  cap: 'butt',
  join: 'miter',
  miterLimit: 4,
  dashArray: [],
  dashOffset: 0,
}

/** Add an N-segment circular fan around (cx, cy) covering arcs from angle a0 to a1. */
function appendArc(out: number[], cx: number, cy: number, r: number, a0: number, a1: number, segments: number): void {
  // CCW direction is determined by the caller's caller; we honour the sign of a1-a0.
  const da = a1 - a0
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const a = a0 + da * t
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
}

/**
 * Build an outline polygon for a stroked polyline.
 *
 * The strategy is the standard "outline both sides + cap + join" approach:
 *   - For each segment, compute its left/right offset rails.
 *   - At joins, fill the gap on the outer side using miter / bevel / round.
 *   - At endpoints (open paths), apply the chosen cap.
 *
 * Returns one or more closed polygons that, filled, produce the stroke.
 */
function signedArea(poly: number[]): number {
  let a = 0
  const n = poly.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += poly[i * 2]! * poly[j * 2 + 1]! - poly[j * 2]! * poly[i * 2 + 1]!
  }
  return a / 2
}

function strokeOutline(poly: number[], st: StrokeStyle, closed: boolean): number[][] {
  const n = poly.length / 2
  if (n < 2) return []
  const half = st.width / 2

  // For closed paths, compute orientation; we want CCW (negative area in
  // screen-down coords) so the "left-rail" (-nx, -ny) is consistently
  // outward and the algorithm's join-direction logic stays sane.
  let normalSign = 1
  if (closed) {
    const a = signedArea(poly)
    if (a > 0) normalSign = -1 // CW input
  }

  // Pre-compute per-segment direction unit vectors and normals.
  interface Seg { ax: number, ay: number, bx: number, by: number, ux: number, uy: number, nx: number, ny: number, len: number }
  const segs: Seg[] = []
  for (let i = 0; i < n - 1; i++) {
    const ax = poly[i * 2]!, ay = poly[i * 2 + 1]!
    const bx = poly[(i + 1) * 2]!, by = poly[(i + 1) * 2 + 1]!
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    segs.push({ ax, ay, bx, by, ux: dx / len, uy: dy / len, nx: -dy / len * normalSign, ny: dx / len * normalSign, len })
  }
  if (closed) {
    const ax = poly[(n - 1) * 2]!, ay = poly[(n - 1) * 2 + 1]!
    const bx = poly[0]!, by = poly[1]!
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len > 0) segs.push({ ax, ay, bx, by, ux: dx / len, uy: dy / len, nx: -dy / len * normalSign, ny: dx / len * normalSign, len })
  }
  if (segs.length === 0) return []

  // Walk segments building the left-side rail forward, then right-side rail back.
  const left: number[] = []
  const right: number[] = []
  // Round-cap arc segment count (proportional to half-width)
  const arcSegs = Math.max(4, Math.ceil(half * 2))

  // Helper: emit a join between consecutive segments.
  const emitJoin = (prev: Seg, cur: Seg): void => {
    const cx = prev.bx, cy = prev.by
    // Inner / outer side determined by sign of cross product.
    const cross = prev.ux * cur.uy - prev.uy * cur.ux
    if (Math.abs(cross) < 1e-9) {
      // Collinear — no join needed.
      return
    }
    if (cross > 0) {
      // Convex on the LEFT (positive normal side) → join on left, inner on right.
      const lpx = cx + prev.nx * half, lpy = cy + prev.ny * half
      const lcx = cx + cur.nx * half, lcy = cy + cur.ny * half
      // Right side: take the inner crossing point (use prev's outgoing offset).
      // For inner side we just push both prev's exit + cur's entry; small sliver overlap is fine.
      right.push(cx - prev.nx * half, cy - prev.ny * half)
      right.push(cx - cur.nx * half, cy - cur.ny * half)
      // Left side: choose join style.
      switch (st.join) {
        case 'bevel':
          left.push(lpx, lpy, lcx, lcy)
          break
        case 'round': {
          left.push(lpx, lpy)
          const a0 = Math.atan2(lpy - cy, lpx - cx)
          let a1 = Math.atan2(lcy - cy, lcx - cx)
          // Walk CCW (positive direction) on the left side.
          if (a1 < a0) a1 += Math.PI * 2
          appendArc(left, cx, cy, half, a0, a1, arcSegs)
          break
        }
        case 'miter': {
          // Compute miter point: intersection of the two offset rails.
          const ax = cx + prev.nx * half - prev.ux * 1e6
          const ay = cy + prev.ny * half - prev.uy * 1e6
          const bx = cx + prev.nx * half
          const by = cy + prev.ny * half
          const cx2 = cx + cur.nx * half
          const cy2 = cy + cur.ny * half
          const dx2 = cx + cur.nx * half + cur.ux * 1e6
          const dy2 = cy + cur.ny * half + cur.uy * 1e6
          // Line 1: (ax,ay)-(bx,by); Line 2: (cx2,cy2)-(dx2,dy2)
          const d1x = bx - ax, d1y = by - ay
          const d2x = dx2 - cx2, d2y = dy2 - cy2
          const det = d1x * d2y - d1y * d2x
          if (Math.abs(det) < 1e-9) {
            left.push(lpx, lpy, lcx, lcy)
            break
          }
          const t = ((cx2 - ax) * d2y - (cy2 - ay) * d2x) / det
          const mx = ax + t * d1x
          const my = ay + t * d1y
          // Apply miter limit.
          const miterDist = Math.hypot(mx - cx, my - cy)
          if (miterDist > st.miterLimit * half) {
            // Fall back to bevel.
            left.push(lpx, lpy, lcx, lcy)
          }
          else {
            left.push(lpx, lpy, mx, my, lcx, lcy)
          }
          break
        }
      }
    }
    else {
      // Convex on the RIGHT.
      const rpx = cx - prev.nx * half, rpy = cy - prev.ny * half
      const rcx = cx - cur.nx * half, rcy = cy - cur.ny * half
      left.push(cx + prev.nx * half, cy + prev.ny * half)
      left.push(cx + cur.nx * half, cy + cur.ny * half)
      switch (st.join) {
        case 'bevel':
          right.push(rpx, rpy, rcx, rcy)
          break
        case 'round': {
          right.push(rpx, rpy)
          const a0 = Math.atan2(rpy - cy, rpx - cx)
          let a1 = Math.atan2(rcy - cy, rcx - cx)
          if (a1 > a0) a1 -= Math.PI * 2 // walk CW
          appendArc(right, cx, cy, half, a0, a1, arcSegs)
          break
        }
        case 'miter': {
          const ax = cx - prev.nx * half - prev.ux * 1e6
          const ay = cy - prev.ny * half - prev.uy * 1e6
          const bx = cx - prev.nx * half
          const by = cy - prev.ny * half
          const cx2 = cx - cur.nx * half
          const cy2 = cy - cur.ny * half
          const dx2 = cx - cur.nx * half + cur.ux * 1e6
          const dy2 = cy - cur.ny * half + cur.uy * 1e6
          const d1x = bx - ax, d1y = by - ay
          const d2x = dx2 - cx2, d2y = dy2 - cy2
          const det = d1x * d2y - d1y * d2x
          if (Math.abs(det) < 1e-9) {
            right.push(rpx, rpy, rcx, rcy)
            break
          }
          const t = ((cx2 - ax) * d2y - (cy2 - ay) * d2x) / det
          const mx = ax + t * d1x
          const my = ay + t * d1y
          const miterDist = Math.hypot(mx - cx, my - cy)
          if (miterDist > st.miterLimit * half) {
            right.push(rpx, rpy, rcx, rcy)
          }
          else {
            right.push(rpx, rpy, mx, my, rcx, rcy)
          }
          break
        }
      }
    }
  }

  // Open path: cap, walk left, end cap, walk right back, close.
  // Closed path: just walk left CCW to a closed polygon, walk right CW to another closed polygon.
  if (!closed) {
    const first = segs[0]!
    const last = segs[segs.length - 1]!

    // Start cap (at first.ax)
    if (st.cap === 'square') {
      // Extend backwards by half along -ux.
      left.push(first.ax + first.nx * half - first.ux * half, first.ay + first.ny * half - first.uy * half)
      right.unshift(first.ax - first.nx * half - first.ux * half, first.ay - first.ny * half - first.uy * half)
    }
    else if (st.cap === 'round') {
      // Half-circle from left rail to right rail at the start.
      const cx = first.ax, cy = first.ay
      const aLeft = Math.atan2(first.ny, first.nx)
      const aRight = aLeft + Math.PI
      const startRing: number[] = []
      // Trace a half-circle from left back through "behind" to right.
      for (let i = 0; i <= arcSegs; i++) {
        const t = i / arcSegs
        const a = aLeft + (aRight - aLeft) * t * -1 // walk CW (away from the path direction)
        startRing.push(cx + Math.cos(a) * half, cy + Math.sin(a) * half)
      }
      // Start the left rail with the second half of the cap (left → behind), and
      // the right rail with the first half of the cap (behind → right).
      // For simplicity we just prepend the entire half-arc to the right side.
      for (let i = startRing.length - 2; i >= 0; i -= 2) {
        right.unshift(startRing[i]!, startRing[i + 1]!)
      }
    }
    // butt cap: no extension; the rails just start at the offset endpoints.

    // Left rail: walk forward, emitting offsets + joins.
    left.push(first.ax + first.nx * half, first.ay + first.ny * half)
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!
      left.push(s.bx + s.nx * half, s.by + s.ny * half)
      if (i + 1 < segs.length) emitJoin(s, segs[i + 1]!)
    }

    // End cap (at last.bx)
    if (st.cap === 'square') {
      left.push(last.bx + last.nx * half + last.ux * half, last.by + last.ny * half + last.uy * half)
      right.unshift(last.bx - last.nx * half + last.ux * half, last.by - last.ny * half + last.uy * half)
    }
    else if (st.cap === 'round') {
      const cx = last.bx, cy = last.by
      const aLeft = Math.atan2(last.ny, last.nx)
      const aRight = aLeft - Math.PI
      // Half-circle from left through "ahead" to right.
      const endRing: number[] = []
      for (let i = 0; i <= arcSegs; i++) {
        const t = i / arcSegs
        const a = aLeft + (aRight - aLeft) * t
        endRing.push(cx + Math.cos(a) * half, cy + Math.sin(a) * half)
      }
      for (let i = 0; i < endRing.length; i += 2) left.push(endRing[i]!, endRing[i + 1]!)
    }

    // Right rail: walk forward (pushing points), so the final polygon is
    // left (forward) → right (reversed) = a closed loop traced CCW.
    right.push(first.ax - first.nx * half, first.ay - first.ny * half)
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!
      right.push(s.bx - s.nx * half, s.by - s.ny * half)
    }

    // Concatenate left forward + right reversed.
    const combined: number[] = [...left]
    for (let i = right.length - 2; i >= 0; i -= 2) combined.push(right[i]!, right[i + 1]!)
    return [combined]
  }

  // Closed: outer + inner contours.
  const outer: number[] = []
  const inner: number[] = []
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    outer.push(s.ax + s.nx * half, s.ay + s.ny * half)
    inner.push(s.ax - s.nx * half, s.ay - s.ny * half)
    if (i + 1 < segs.length) emitJoin(s, segs[i + 1]!)
  }
  emitJoin(segs[segs.length - 1]!, segs[0]!)
  // Reverse the inner polygon point-wise so its winding opposes the outer.
  const innerRev: number[] = []
  for (let i = inner.length - 2; i >= 0; i -= 2) innerRev.push(inner[i]!, inner[i + 1]!)
  return [outer, innerRev]
}

/** Walk one polyline applying dasharray + dashoffset, returning the dash subpaths. */
function dashedSubpaths(poly: number[], dashArray: number[], dashOffset: number, closed: boolean): number[][] {
  // Total dash period
  const period = dashArray.reduce((s, n) => s + n, 0)
  if (period <= 0) return [poly]

  // Effective array: if odd length, double per spec.
  const arr = dashArray.length % 2 === 1 ? [...dashArray, ...dashArray] : dashArray.slice()
  const periodEff = arr.reduce((s, n) => s + n, 0)

  // Resolve initial state from dashOffset.
  let off = dashOffset % periodEff
  if (off < 0) off += periodEff

  // Find starting index + position within dash.
  let idx = 0
  let acc = 0
  while (acc + arr[idx]! <= off) {
    acc += arr[idx]!
    idx = (idx + 1) % arr.length
  }
  let remainInDash = arr[idx]! - (off - acc)
  let drawing = idx % 2 === 0 // even index = on (dash), odd = off (gap)

  const out: number[][] = []
  let current: number[] | null = null
  let curX = poly[0]!, curY = poly[1]!
  if (drawing) { current = [curX, curY]; out.push(current) }

  const pushPoint = (x: number, y: number) => {
    if (drawing) {
      if (!current) { current = [x, y]; out.push(current) }
      else current.push(x, y)
    }
  }

  const segCount = closed ? poly.length / 2 : poly.length / 2 - 1
  for (let i = 0; i < segCount; i++) {
    const j = ((i + 1) * 2) % poly.length
    const tx = poly[j]!, ty = poly[j + 1]!
    let dx = tx - curX, dy = ty - curY
    let segLen = Math.hypot(dx, dy)
    if (segLen === 0) { curX = tx; curY = ty; continue }
    const ux = dx / segLen, uy = dy / segLen
    while (segLen > 0) {
      if (remainInDash >= segLen) {
        // Consume the whole segment in this dash phase.
        pushPoint(tx, ty)
        remainInDash -= segLen
        curX = tx; curY = ty
        segLen = 0
      }
      else {
        const cx = curX + ux * remainInDash
        const cy = curY + uy * remainInDash
        pushPoint(cx, cy)
        // Advance the dash phase.
        idx = (idx + 1) % arr.length
        drawing = !drawing
        if (drawing) {
          current = [cx, cy]
          out.push(current)
        }
        else {
          current = null
        }
        segLen -= remainInDash
        remainInDash = arr[idx]!
        curX = cx; curY = cy
        dx = tx - curX; dy = ty - curY
      }
    }
  }
  return out.filter(s => s.length >= 4)
}

/**
 * Stroke a polyline with full SVG semantics: cap, join, miter limit, dash array.
 */
export function strokePolylines(
  fb: Framebuffer,
  polys: number[][],
  paint: Paint,
  style: number | StrokeStyle,
  closed: boolean,
): void {
  const st: StrokeStyle = typeof style === 'number'
    ? { ...DEFAULT_STROKE, width: style }
    : { ...DEFAULT_STROKE, ...style }
  if (st.width <= 0) return
  if (isSolid(paint) && paint.a === 0) return

  // Apply dash subdivision per polyline first.
  const subpaths: Array<{ poly: number[], closed: boolean }> = []
  for (const poly of polys) {
    if (st.dashArray.length > 0) {
      for (const sp of dashedSubpaths(poly, st.dashArray, st.dashOffset, closed)) {
        // Dashes always render as open subpaths (each dash has its own caps).
        subpaths.push({ poly: sp, closed: false })
      }
    }
    else {
      subpaths.push({ poly, closed })
    }
  }

  // Outline + fill.
  const outlines: number[][] = []
  for (const sp of subpaths) {
    for (const o of strokeOutline(sp.poly, st, sp.closed)) outlines.push(o)
  }
  fillPolygons(fb, outlines, paint)
}
