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
  // Default background is transparent (a=0); Uint8Array is zero-filled, so
  // we can skip the per-pixel write entirely. This matters because every
  // rasterize() call creates a fresh framebuffer.
  if (bg.a === 0 && bg.r === 0 && bg.g === 0 && bg.b === 0) {
    return { width, height, data }
  }
  // Solid colour: pack RGBA into a single 32-bit word and use Uint32Array
  // to fill 4 bytes per write instead of 4 separate stores per pixel.
  if (data.byteLength % 4 === 0) {
    const u32 = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2)
    // Endianness-aware pack: write a probe pixel through Uint8Array, read
    // back through Uint32Array, and use the resulting word as the fill key.
    data[0] = bg.r; data[1] = bg.g; data[2] = bg.b; data[3] = bg.a
    u32.fill(u32[0]!)
  }
  else {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bg.r; data[i + 1] = bg.g; data[i + 2] = bg.b; data[i + 3] = bg.a
    }
  }
  return { width, height, data }
}

/**
 * Composite an RGBA value over a single pixel of the framebuffer with the
 * given coverage in [0, 1].
 *
 * Hot path: source-over blending on every covered pixel of every shape.
 * Three fast paths:
 *  - opaque source over empty destination (a == 255 && dstA == 0): straight write
 *  - opaque source (a == 255): premultiplied lerp by coverage with integer math
 *  - general: full source-over with float math
 */
function blendPixel(fb: Framebuffer, x: number, y: number, color: RGBA, coverage: number): void {
  if (coverage <= 0) return
  if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return
  const data = fb.data
  const idx = (y * fb.width + x) * 4
  const srcAlpha = color.a
  if (srcAlpha === 255 && coverage >= 1) {
    data[idx] = color.r
    data[idx + 1] = color.g
    data[idx + 2] = color.b
    data[idx + 3] = 255
    return
  }
  const srcA255 = (srcAlpha * coverage) | 0
  if (srcA255 === 0) return
  const dstA = data[idx + 3]!
  if (dstA === 0) {
    data[idx] = color.r
    data[idx + 1] = color.g
    data[idx + 2] = color.b
    data[idx + 3] = srcA255
    return
  }
  // General source-over. Factor srcA/outA and dstAf*(1-srcA)/outA out of
  // each channel — saves two multiplies per channel (six total per pixel).
  const srcA = srcA255 / 255
  const dstAf = dstA / 255
  const oneMinus = 1 - srcA
  const outA = srcA + dstAf * oneMinus
  if (outA === 0) return
  const inv = 1 / outA
  const sw = srcA * inv
  const dw = dstAf * oneMinus * inv
  data[idx]     = (color.r * sw + data[idx]!     * dw + 0.5) | 0
  data[idx + 1] = (color.g * sw + data[idx + 1]! * dw + 0.5) | 0
  data[idx + 2] = (color.b * sw + data[idx + 2]! * dw + 0.5) | 0
  data[idx + 3] = ((outA * 255) + 0.5) | 0
}

/**
 * Rasterise a set of polygons (multiple sub-paths) with the given fill
 * rule (`nonzero` default, `evenodd` opt-in) and analytical horizontal AA
 * (4 sub-pixel samples per scanline).
 *
 * `polys` is an array of contours; each contour is a flat polyline
 * `[x0, y0, x1, y1, ...]` (closed implicitly via wrap).
 *
 * `paint` may be a solid `RGBA` colour or a `{ sample(x, y): RGBA }` source
 * (e.g. a gradient evaluated per pixel).
 */
// Module-level scratch buffers reused across fillPolygons calls. The
// rasterizer is hot — every shape allocates these on the order of
// (fbH * 4 entries) + (fbW float32s), which adds up to MB of garbage on
// big SVGs. Reusing them keeps the GC quiet.
let scratchBuckets: Array<number[] | undefined> = []
let scratchRowSeen: Uint8Array = new Uint8Array(0)
let scratchCov: Float32Array = new Float32Array(0)
let scratchDirtyRows: number[] = []

export function fillPolygons(
  fb: Framebuffer,
  polys: number[][],
  paint: Paint,
  fillRule: 'nonzero' | 'evenodd' = 'nonzero',
): void {
  if (polys.length === 0) return
  const solid = isSolid(paint) ? paint : null
  if (solid && solid.a === 0) return

  const SAMPLES = 4
  const sampleW = 1 / SAMPLES
  const fbW = fb.width
  const fbH = fb.height
  const isEvenOdd = fillRule === 'evenodd'

  // Reuse module-level scratch buffers. We grow them on demand and reuse
  // them — `buckets` and `dirtyRows` are reset via the dirty-row list at
  // the end of the function so we never have to scan the full bucket array.
  const need = fbH * SAMPLES
  let buckets = scratchBuckets
  if (buckets.length < need) {
    buckets = new Array(need)
    scratchBuckets = buckets
  }
  let rowSeen = scratchRowSeen
  if (rowSeen.length < fbH) {
    rowSeen = new Uint8Array(fbH)
    scratchRowSeen = rowSeen
  }
  let cov = scratchCov
  if (cov.length < fbW) {
    cov = new Float32Array(fbW)
    scratchCov = cov
  }
  const dirtyRows = scratchDirtyRows
  dirtyRows.length = 0

  // Build edges directly into per-sample-line buckets.
  for (let pi = 0; pi < polys.length; pi++) {
    const poly = polys[pi]!
    const np = poly.length / 2
    for (let i = 0; i < np; i++) {
      const j = (i + 1) % np
      const ax = poly[i * 2]!, ay = poly[i * 2 + 1]!
      const bx = poly[j * 2]!, by = poly[j * 2 + 1]!
      if (ay === by) continue // horizontal — contributes nothing
      let yTop: number, yBot: number, xTop: number, dxdy: number, winding: number
      if (ay < by) {
        yTop = ay; yBot = by; xTop = ax
        dxdy = (bx - ax) / (by - ay)
        winding = 1
      }
      else {
        yTop = by; yBot = ay; xTop = bx
        dxdy = (ax - bx) / (ay - by)
        winding = -1
      }
      const yTopSub = Math.floor(yTop * SAMPLES)
      const yBotSub = Math.ceil(yBot * SAMPLES)
      for (let ys = yTopSub; ys < yBotSub; ys++) {
        const yReal = (ys + 0.5) / SAMPLES
        if (yReal < yTop || yReal >= yBot) continue
        const targetRow = ys >= 0 ? (ys / SAMPLES) | 0 : Math.floor(ys / SAMPLES)
        if (targetRow < 0 || targetRow >= fbH) continue
        const sampleIdx = ((ys % SAMPLES) + SAMPLES) % SAMPLES
        const x = xTop + dxdy * (yReal - yTop)
        const bIdx = targetRow * SAMPLES + sampleIdx
        let bucket = buckets[bIdx]
        if (bucket === undefined) {
          bucket = []
          buckets[bIdx] = bucket
        }
        bucket.push(x, winding)
        if (rowSeen[targetRow] === 0) {
          rowSeen[targetRow] = 1
          dirtyRows.push(targetRow)
        }
      }
    }
  }

  // (cov / buckets / rowSeen / dirtyRows are pooled at module scope above.)

  for (let r = 0; r < dirtyRows.length; r++) {
    const row = dirtyRows[r]!
    let minPx = fbW
    let maxPx = -1

    for (let s = 0; s < SAMPLES; s++) {
      const list = buckets[row * SAMPLES + s]
      if (list === undefined) continue
      // In-place insertion sort over (x, w) pairs — typical bucket has a
      // handful of crossings, so this is O(n) faster than Array.sort with a
      // boxed comparator allocation.
      const m = list.length
      for (let i = 2; i < m; i += 2) {
        const x = list[i]!
        const w = list[i + 1]!
        let k = i - 2
        while (k >= 0 && list[k]! > x) {
          list[k + 2] = list[k]!
          list[k + 3] = list[k + 1]!
          k -= 2
        }
        list[k + 2] = x
        list[k + 3] = w
      }

      let winding = 0
      let parity = 0
      let prev = 0
      let prevInside = false
      for (let i = 0; i < m; i += 2) {
        const cx = list[i]!
        const cw = list[i + 1]!
        if (prevInside) {
          let a = prev
          if (a < 0) a = 0
          let b = cx
          if (b > fbW) b = fbW
          if (b > a) {
            const xa = a | 0
            const xb = b | 0
            if (xa < minPx) minPx = xa
            if (xb > maxPx) maxPx = xb
            if (xa === xb) {
              cov[xa]! += (b - a) * sampleW
            }
            else {
              cov[xa]! += (xa + 1 - a) * sampleW
              for (let px = xa + 1; px < xb; px++) cov[px]! += sampleW
              cov[xb]! += (b - xb) * sampleW
            }
          }
        }
        winding += cw
        parity ^= 1
        prevInside = isEvenOdd ? parity === 1 : winding !== 0
        prev = cx
      }
    }

    if (maxPx >= 0) {
      if (maxPx >= fbW) maxPx = fbW - 1
      const fbData = fb.data
      const rowBase = row * fbW * 4

      // Specialise the inner loop on whether the paint is a solid fully-opaque
      // RGBA. The opaque-solid case is overwhelmingly common (icons, UI shapes)
      // and lets us hoist alpha tests + four hot constants out of the loop.
      if (solid && solid.a === 255) {
        const sR = solid.r, sG = solid.g, sB = solid.b
        for (let px = minPx; px <= maxPx; px++) {
          const c = cov[px]!
          if (c <= 0) continue
          cov[px] = 0
          const idx = rowBase + px * 4
          if (c >= 1) {
            // Full coverage — overwrite.
            fbData[idx] = sR; fbData[idx + 1] = sG; fbData[idx + 2] = sB; fbData[idx + 3] = 255
            continue
          }
          // Partial coverage — coverage IS the source alpha (255 * c).
          const srcA255 = (255 * c) | 0
          if (srcA255 === 0) continue
          const dstA = fbData[idx + 3]!
          if (dstA === 0) {
            fbData[idx] = sR; fbData[idx + 1] = sG; fbData[idx + 2] = sB; fbData[idx + 3] = srcA255
            continue
          }
          const srcA = srcA255 / 255
          const dstAf = dstA / 255
          const oneMinus = 1 - srcA
          const outA = srcA + dstAf * oneMinus
          const inv = 1 / outA
          const sw = srcA * inv
          const dw = dstAf * oneMinus * inv
          fbData[idx]     = (sR * sw + fbData[idx]!     * dw + 0.5) | 0
          fbData[idx + 1] = (sG * sw + fbData[idx + 1]! * dw + 0.5) | 0
          fbData[idx + 2] = (sB * sw + fbData[idx + 2]! * dw + 0.5) | 0
          fbData[idx + 3] = ((outA * 255) + 0.5) | 0
        }
      }
      else {
        const sampleFn = solid ? null : (paint as { sample: (x: number, y: number) => RGBA }).sample
        const sR = solid ? solid.r : 0
        const sG = solid ? solid.g : 0
        const sB = solid ? solid.b : 0
        const sA = solid ? solid.a : 0
        for (let px = minPx; px <= maxPx; px++) {
          const c = cov[px]!
          if (c <= 0) continue
          cov[px] = 0
          const coverage = c < 1 ? c : 1
          const idx = rowBase + px * 4
          let cr: number, cg: number, cb: number, ca: number
          if (solid) {
            cr = sR; cg = sG; cb = sB; ca = sA
          }
          else {
            const color = sampleFn!(px + 0.5, row + 0.5)
            cr = color.r; cg = color.g; cb = color.b; ca = color.a
          }
          if (ca === 0) continue
          if (ca === 255 && coverage >= 1) {
            fbData[idx] = cr; fbData[idx + 1] = cg; fbData[idx + 2] = cb; fbData[idx + 3] = 255
            continue
          }
          const srcA255 = (ca * coverage) | 0
          if (srcA255 === 0) continue
          const dstA = fbData[idx + 3]!
          if (dstA === 0) {
            fbData[idx] = cr; fbData[idx + 1] = cg; fbData[idx + 2] = cb; fbData[idx + 3] = srcA255
            continue
          }
          const srcA = srcA255 / 255
          const dstAf = dstA / 255
          const oneMinus = 1 - srcA
          const outA = srcA + dstAf * oneMinus
          if (outA === 0) continue
          const inv = 1 / outA
          const sw = srcA * inv
          const dw = dstAf * oneMinus * inv
          fbData[idx]     = (cr * sw + fbData[idx]!     * dw + 0.5) | 0
          fbData[idx + 1] = (cg * sw + fbData[idx + 1]! * dw + 0.5) | 0
          fbData[idx + 2] = (cb * sw + fbData[idx + 2]! * dw + 0.5) | 0
          fbData[idx + 3] = ((outA * 255) + 0.5) | 0
        }
      }
    }
    // Reset per-row state so this row is clean for the next fillPolygons call.
    // Keep the bucket arrays themselves around (length-truncated) — that way
    // subsequent calls hit the array reuse path and skip the alloc.
    rowSeen[row] = 0
    for (let s = 0; s < SAMPLES; s++) {
      const list = buckets[row * SAMPLES + s]
      if (list !== undefined && list.length !== 0) list.length = 0
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

/** Add an N-segment circular fan around (cx, cy) covering arcs from angle a0 to a1.
 *
 * Uses a two-multiplication rotation recurrence: cosine and sine for the
 * step angle are computed once, then each successive (cos, sin) pair is
 * derived via the rotation identity. Replaces 2N transcendental calls
 * with two upfront. */
function appendArc(out: number[], cx: number, cy: number, r: number, a0: number, a1: number, segments: number): void {
  const step = (a1 - a0) / segments
  const cs = Math.cos(step)
  const sn = Math.sin(step)
  let cosA = Math.cos(a0)
  let sinA = Math.sin(a0)
  for (let i = 1; i <= segments; i++) {
    const newCos = cosA * cs - sinA * sn
    sinA = sinA * cs + cosA * sn
    cosA = newCos
    out.push(cx + cosA * r, cy + sinA * r)
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
  const n = poly.length
  if (n < 6) return 0
  let a = 0
  // Walk pairs (i, i+1) up to the second-to-last vertex; the wraparound
  // contribution from last→first is added explicitly to avoid `% n` in
  // the hot loop.
  for (let i = 0; i < n - 2; i += 2) {
    a += poly[i]! * poly[i + 3]! - poly[i + 2]! * poly[i + 1]!
  }
  // Last edge: (n-2, n-1) → (0, 1)
  a += poly[n - 2]! * poly[1]! - poly[0]! * poly[n - 1]!
  return a * 0.5
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
  // Round-cap segment count grows with sqrt(half) — perimeter scales linearly
  // with radius, but visual perception of segment count tapers with sqrt.
  // Result: a 1px stroke gets 4 segs, a 16px stroke gets 16, a 256px stroke
  // gets ~64. Linear `half * 2` overshot for typical SVG widths.
  const arcSegs = Math.max(4, Math.min(64, Math.ceil(Math.sqrt(half) * 4)))

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

    // The original implementation built the right rail by `unshift`-ing the
    // cap points into the front — O(n²) when the cap is a fine arc. Instead,
    // accumulate the points that should appear at the END of the combined
    // polygon (after the reversed forward offsets) into separate buffers and
    // concat them once at the end.
    const trailingStart: number[] = [] // appears after fwd-offsets-reversed
    const trailingEnd: number[] = [] // appears after trailingStart

    // Start cap (at first.ax)
    if (st.cap === 'square') {
      left.push(first.ax + first.nx * half - first.ux * half, first.ay + first.ny * half - first.uy * half)
      trailingStart.push(first.ax - first.nx * half - first.ux * half, first.ay - first.ny * half - first.uy * half)
    }
    else if (st.cap === 'round') {
      // Half-arc traced CCW: starts at the right-rail offset point, walks
      // through "behind", finishes at the left-rail offset point. This is the
      // order needed at the tail of the combined polygon so the loop closes
      // correctly without `unshift`.
      const cx = first.ax, cy = first.ay
      const aLeft = Math.atan2(first.ny, first.nx)
      const aRight = aLeft + Math.PI
      for (let i = arcSegs; i >= 0; i--) {
        const t = i / arcSegs
        const a = aLeft - (aRight - aLeft) * t
        trailingStart.push(cx + Math.cos(a) * half, cy + Math.sin(a) * half)
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
      trailingEnd.push(last.bx - last.nx * half + last.ux * half, last.by - last.ny * half + last.uy * half)
    }
    else if (st.cap === 'round') {
      const cx = last.bx, cy = last.by
      const aLeft = Math.atan2(last.ny, last.nx)
      const aRight = aLeft - Math.PI
      for (let i = 0; i <= arcSegs; i++) {
        const t = i / arcSegs
        const a = aLeft + (aRight - aLeft) * t
        left.push(cx + Math.cos(a) * half, cy + Math.sin(a) * half)
      }
    }

    // Right rail forward (will be reversed into the final polygon).
    right.push(first.ax - first.nx * half, first.ay - first.ny * half)
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!
      right.push(s.bx - s.nx * half, s.by - s.ny * half)
    }

    // Final order: [left fwd] + [right reversed] + [trailingStart] + [trailingEnd].
    // This matches the original `unshift`-based output exactly, but builds in O(n).
    const combined: number[] = left.slice()
    for (let i = right.length - 2; i >= 0; i -= 2) combined.push(right[i]!, right[i + 1]!)
    for (let i = 0; i < trailingStart.length; i++) combined.push(trailingStart[i]!)
    for (let i = 0; i < trailingEnd.length; i++) combined.push(trailingEnd[i]!)
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
  let period = 0
  for (let i = 0; i < dashArray.length; i++) period += dashArray[i]!
  if (period <= 0) return [poly]

  // Effective array: if odd length, double per spec.
  let arr: number[]
  let periodEff: number
  if ((dashArray.length & 1) === 1) {
    const inLen = dashArray.length
    arr = new Array<number>(inLen * 2)
    for (let i = 0; i < inLen; i++) { arr[i] = dashArray[i]!; arr[i + inLen] = dashArray[i]! }
    periodEff = period * 2
  }
  else {
    arr = dashArray
    periodEff = period
  }

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
  // even index = on (dash), odd index = off (gap)
  let drawing = idx % 2 === 0

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
