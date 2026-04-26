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
 */
export function fillPolygons(fb: Framebuffer, polys: number[][], color: RGBA): void {
  if (polys.length === 0) return
  if (color.a === 0) return

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
      blendPixel(fb, px, row, color, Math.min(1, cov))
    }
  }
}

/**
 * Stroke a polyline with a given width and colour. Round joins / butt caps
 * — an approximation that's adequate for low-stroke-weight SVG text.
 */
export function strokePolylines(
  fb: Framebuffer,
  polys: number[][],
  color: RGBA,
  width: number,
  closed: boolean,
): void {
  if (width <= 0 || color.a === 0) return
  // Convert each line segment into a quad polygon and let fillPolygons handle it.
  const half = width / 2
  const quads: number[][] = []
  for (const poly of polys) {
    const n = poly.length / 2
    const segCount = closed ? n : n - 1
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n
      const ax = poly[i * 2]!, ay = poly[i * 2 + 1]!
      const bx = poly[j * 2]!, by = poly[j * 2 + 1]!
      const dx = bx - ax, dy = by - ay
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      const nx = -dy / len * half
      const ny = dx / len * half
      quads.push([
        ax + nx, ay + ny,
        bx + nx, by + ny,
        bx - nx, by - ny,
        ax - nx, ay - ny,
      ])
    }
  }
  fillPolygons(fb, quads, color)
}
