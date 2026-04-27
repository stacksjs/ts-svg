/**
 * SVG path `d` attribute parser + flattener.
 *
 * Parses the full grammar (M m L l H h V v C c S s Q q T t A a Z z) into a
 * normalised list of absolute-coordinate commands, then flattens cubics,
 * quadratics, and arcs into straight-line segments suitable for the
 * scanline rasterizer.
 *
 * Spec: https://www.w3.org/TR/SVG11/paths.html#PathData
 */

export type PathCmd =
  | { t: 'M', x: number, y: number }
  | { t: 'L', x: number, y: number }
  | { t: 'C', x1: number, y1: number, x2: number, y2: number, x: number, y: number }
  | { t: 'Q', x1: number, y1: number, x: number, y: number }
  | { t: 'A', rx: number, ry: number, xAxisRot: number, largeArc: boolean, sweep: boolean, x: number, y: number }
  | { t: 'Z' }

const CMD_RE = /([a-zA-Z])([^a-zA-Z]*)/g
const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function readNumbers(s: string): number[] {
  const m = s.match(NUM_RE)
  return m ? m.map(Number) : []
}

/** Parse an SVG path `d` string into absolute-coordinate commands. */
export function parsePath(d: string): PathCmd[] {
  const out: PathCmd[] = []
  let cx = 0, cy = 0 // current point
  let startX = 0, startY = 0 // subpath start
  let prevC2x = 0, prevC2y = 0 // previous cubic control2 (for S/s)
  let prevQ1x = 0, prevQ1y = 0 // previous quadratic control1 (for T/t)
  let prevCmd = ''

  let m: RegExpExecArray | null
  CMD_RE.lastIndex = 0
  while ((m = CMD_RE.exec(d)) != null) {
    const cmd = m[1]!
    const rel = cmd === cmd.toLowerCase()
    const upper = cmd.toUpperCase()
    const nums = readNumbers(m[2]!)
    let i = 0
    let first = true

    while (true) {
      switch (upper) {
        case 'M': {
          if (i + 1 >= nums.length) { i = nums.length; break }
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x += cx; y += cy }
          if (first) {
            out.push({ t: 'M', x, y })
            startX = x; startY = y
            cx = x; cy = y
            // Subsequent coord pairs after M are implicit lineto
            first = false
          }
          else {
            out.push({ t: 'L', x, y })
            cx = x; cy = y
          }
          break
        }
        case 'L': {
          if (i + 1 >= nums.length) { i = nums.length; break }
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x += cx; y += cy }
          out.push({ t: 'L', x, y })
          cx = x; cy = y
          break
        }
        case 'H': {
          if (i >= nums.length) { i = nums.length; break }
          let x = nums[i++]!
          if (rel) x += cx
          out.push({ t: 'L', x, y: cy })
          cx = x
          break
        }
        case 'V': {
          if (i >= nums.length) { i = nums.length; break }
          let y = nums[i++]!
          if (rel) y += cy
          out.push({ t: 'L', x: cx, y })
          cy = y
          break
        }
        case 'C': {
          if (i + 5 >= nums.length) { i = nums.length; break }
          let x1 = nums[i++]!, y1 = nums[i++]!
          let x2 = nums[i++]!, y2 = nums[i++]!
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy }
          out.push({ t: 'C', x1, y1, x2, y2, x, y })
          prevC2x = x2; prevC2y = y2
          cx = x; cy = y
          break
        }
        case 'S': {
          if (i + 3 >= nums.length) { i = nums.length; break }
          let x2 = nums[i++]!, y2 = nums[i++]!
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy }
          // Reflect prev control if previous command was C/S/s.
          let x1 = cx, y1 = cy
          if (prevCmd === 'C' || prevCmd === 'S') {
            x1 = 2 * cx - prevC2x
            y1 = 2 * cy - prevC2y
          }
          out.push({ t: 'C', x1, y1, x2, y2, x, y })
          prevC2x = x2; prevC2y = y2
          cx = x; cy = y
          break
        }
        case 'Q': {
          if (i + 3 >= nums.length) { i = nums.length; break }
          let x1 = nums[i++]!, y1 = nums[i++]!
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy }
          out.push({ t: 'Q', x1, y1, x, y })
          prevQ1x = x1; prevQ1y = y1
          cx = x; cy = y
          break
        }
        case 'T': {
          if (i + 1 >= nums.length) { i = nums.length; break }
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x += cx; y += cy }
          let x1 = cx, y1 = cy
          if (prevCmd === 'Q' || prevCmd === 'T') {
            x1 = 2 * cx - prevQ1x
            y1 = 2 * cy - prevQ1y
          }
          out.push({ t: 'Q', x1, y1, x, y })
          prevQ1x = x1; prevQ1y = y1
          cx = x; cy = y
          break
        }
        case 'A': {
          if (i + 6 >= nums.length) { i = nums.length; break }
          const rx = Math.abs(nums[i++]!)
          const ry = Math.abs(nums[i++]!)
          const rot = nums[i++]!
          const largeArc = !!nums[i++]!
          const sweep = !!nums[i++]!
          let x = nums[i++]!, y = nums[i++]!
          if (rel) { x += cx; y += cy }
          out.push({ t: 'A', rx, ry, xAxisRot: rot, largeArc, sweep, x, y })
          cx = x; cy = y
          break
        }
        case 'Z': {
          out.push({ t: 'Z' })
          cx = startX; cy = startY
          break
        }
      }
      prevCmd = upper
      first = false
      // Some commands (Z) take no operands
      if (upper === 'Z') break
      if (i >= nums.length) break
      // Implicit repeat of the same command
    }
  }
  return out
}

/**
 * Convert a single SVG arc command into a sequence of cubic Beziers.
 *
 * Reference: SVG implementation notes appendix.
 */
export function arcToCubics(
  x0: number, y0: number,
  rx: number, ry: number,
  xAxisRotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number, y1: number,
): Array<{ c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number }> {
  if (rx === 0 || ry === 0) return [{ c1x: x0, c1y: y0, c2x: x1, c2y: y1, x: x1, y: y1 }]

  const phi = (xAxisRotDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // Step 1: compute (x1', y1')
  const dx = (x0 - x1) / 2
  const dy = (y0 - y1) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  // Ensure radii are large enough
  let rxAbs = Math.abs(rx)
  let ryAbs = Math.abs(ry)
  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs)
  if (lambda > 1) {
    const sqrtL = Math.sqrt(lambda)
    rxAbs *= sqrtL
    ryAbs *= sqrtL
  }

  const rx2 = rxAbs * rxAbs
  const ry2 = ryAbs * ryAbs
  const x1p2 = x1p * x1p
  const y1p2 = y1p * y1p
  const num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2
  const denom = rx2 * y1p2 + ry2 * x1p2
  let factor = denom === 0 ? 0 : Math.sqrt(Math.max(0, num / denom))
  if (largeArc === sweep) factor = -factor
  const cxp = factor * (rxAbs * y1p) / ryAbs
  const cyp = -factor * (ryAbs * x1p) / rxAbs

  // Step 3: center
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2

  // Step 4: angles
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy)
    if (len === 0) return 0 // degenerate input — angle undefined; treat as 0
    const dot = ux * vx + uy * vy
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs)
  let dTheta = angle((x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs, (-x1p - cxp) / rxAbs, (-y1p - cyp) / ryAbs)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  // Subdivide into pieces of at most pi/2 to keep cubic approximation tight.
  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)))
  const delta = dTheta / n
  const t = (8 / 3) * Math.sin(delta / 4) ** 2 / Math.sin(delta / 2)

  const out: Array<{ c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number }> = []
  let prevX = x0, prevY = y0
  let prevAngle = theta1
  for (let i = 0; i < n; i++) {
    const a1 = prevAngle
    const a2 = prevAngle + delta
    const cosA1 = Math.cos(a1), sinA1 = Math.sin(a1)
    const cosA2 = Math.cos(a2), sinA2 = Math.sin(a2)
    // Endpoint of this segment in parameter space
    const ex = cosPhi * (rxAbs * cosA2) - sinPhi * (ryAbs * sinA2) + cx
    const ey = sinPhi * (rxAbs * cosA2) + cosPhi * (ryAbs * sinA2) + cy
    // Tangents
    const c1x = prevX + t * (cosPhi * (-rxAbs * sinA1) - sinPhi * (ryAbs * cosA1))
    const c1y = prevY + t * (sinPhi * (-rxAbs * sinA1) + cosPhi * (ryAbs * cosA1))
    const c2x = ex - t * (cosPhi * (-rxAbs * sinA2) - sinPhi * (ryAbs * cosA2))
    const c2y = ey - t * (sinPhi * (-rxAbs * sinA2) + cosPhi * (ryAbs * cosA2))
    out.push({ c1x, c1y, c2x, c2y, x: ex, y: ey })
    prevX = ex; prevY = ey
    prevAngle = a2
  }
  return out
}

/**
 * Recursion guard: a 16-level subdivision is enough for any tolerance ≥
 * UPM/2^16 ≈ 0.015 px on a 1000 UPM glyph. Pathological inputs (cusps,
 * near-degenerate curves) that don't converge are forced to flat at this
 * depth — a tiny visible artefact is preferable to a stack overflow.
 */
const MAX_FLATTEN_DEPTH = 16

/**
 * Adaptive subdivision of a cubic Bezier into line segments.
 * `tolerance` is the maximum allowed sagitta (deviation) in pixels.
 */
export function flattenCubic(
  x0: number, y0: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  x1: number, y1: number,
  tolerance: number,
  out: number[],
  depth = 0,
): void {
  if (depth >= MAX_FLATTEN_DEPTH) { out.push(x1, y1); return }
  // Estimate flatness: max distance from control points to chord.
  const dx = x1 - x0
  const dy = y1 - y0
  const denom = dx * dx + dy * dy
  let d1, d2
  if (denom === 0) {
    d1 = Math.hypot(c1x - x0, c1y - y0)
    d2 = Math.hypot(c2x - x1, c2y - y1)
  }
  else {
    d1 = Math.abs((c1x - x1) * dy - (c1y - y1) * dx) / Math.sqrt(denom)
    d2 = Math.abs((c2x - x1) * dy - (c2y - y1) * dx) / Math.sqrt(denom)
  }
  if (Math.max(d1, d2) <= tolerance) {
    out.push(x1, y1)
    return
  }
  // De Casteljau split at t=0.5
  const m12x = (x0 + c1x) / 2, m12y = (y0 + c1y) / 2
  const m23x = (c1x + c2x) / 2, m23y = (c1y + c2y) / 2
  const m34x = (c2x + x1) / 2, m34y = (c2y + y1) / 2
  const m123x = (m12x + m23x) / 2, m123y = (m12y + m23y) / 2
  const m234x = (m23x + m34x) / 2, m234y = (m23y + m34y) / 2
  const mx = (m123x + m234x) / 2, my = (m123y + m234y) / 2
  flattenCubic(x0, y0, m12x, m12y, m123x, m123y, mx, my, tolerance, out, depth + 1)
  flattenCubic(mx, my, m234x, m234y, m34x, m34y, x1, y1, tolerance, out, depth + 1)
}

/** Adaptive subdivision of a quadratic Bezier into line segments. */
export function flattenQuadratic(
  x0: number, y0: number,
  c1x: number, c1y: number,
  x1: number, y1: number,
  tolerance: number,
  out: number[],
  depth = 0,
): void {
  if (depth >= MAX_FLATTEN_DEPTH) { out.push(x1, y1); return }
  // Estimate flatness as the distance from control point to chord.
  const dx = x1 - x0, dy = y1 - y0
  const denom = dx * dx + dy * dy
  const d = denom === 0
    ? Math.hypot(c1x - x0, c1y - y0)
    : Math.abs((c1x - x1) * dy - (c1y - y1) * dx) / Math.sqrt(denom)
  if (d <= tolerance) {
    out.push(x1, y1)
    return
  }
  const m12x = (x0 + c1x) / 2, m12y = (y0 + c1y) / 2
  const m23x = (c1x + x1) / 2, m23y = (c1y + y1) / 2
  const mx = (m12x + m23x) / 2
  const my = (m12y + m23y) / 2
  flattenQuadratic(x0, y0, m12x, m12y, mx, my, tolerance, out, depth + 1)
  flattenQuadratic(mx, my, m23x, m23y, x1, y1, tolerance, out, depth + 1)
}

/**
 * Flatten a sequence of path commands into a list of contours, where each
 * contour is a flat polyline `[x0, y0, x1, y1, ...]`. Cubics, quadratics
 * and arcs are tessellated to `tolerance` pixels.
 */
export function flattenCommands(cmds: PathCmd[], tolerance = 0.25): number[][] {
  const contours: number[][] = []
  let current: number[] | null = null
  let cx = 0, cy = 0
  let startX = 0, startY = 0
  for (const c of cmds) {
    switch (c.t) {
      case 'M':
        current = [c.x, c.y]
        contours.push(current)
        cx = c.x; cy = c.y
        startX = c.x; startY = c.y
        break
      case 'L':
        if (!current) break
        current.push(c.x, c.y)
        cx = c.x; cy = c.y
        break
      case 'C':
        if (!current) break
        flattenCubic(cx, cy, c.x1, c.y1, c.x2, c.y2, c.x, c.y, tolerance, current)
        cx = c.x; cy = c.y
        break
      case 'Q':
        if (!current) break
        flattenQuadratic(cx, cy, c.x1, c.y1, c.x, c.y, tolerance, current)
        cx = c.x; cy = c.y
        break
      case 'A': {
        if (!current) break
        const cubics = arcToCubics(cx, cy, c.rx, c.ry, c.xAxisRot, c.largeArc, c.sweep, c.x, c.y)
        for (const cu of cubics) {
          flattenCubic(cx, cy, cu.c1x, cu.c1y, cu.c2x, cu.c2y, cu.x, cu.y, tolerance, current)
          cx = cu.x; cy = cu.y
        }
        break
      }
      case 'Z':
        if (current) {
          current.push(startX, startY)
        }
        cx = startX; cy = startY
        current = null
        break
    }
  }
  return contours.filter(c => c.length >= 4)
}
