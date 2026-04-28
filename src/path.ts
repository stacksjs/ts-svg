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

/** Position-aware tokenizer over the path-data string. */
class PathLex {
  private pos = 0
  constructor(private readonly src: string) {}

  /** Skip whitespace + commas. */
  skipWs(): void {
    const s = this.src
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos)
      // space, tab, LF, CR, comma
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) this.pos++
      else break
    }
  }

  done(): boolean {
    this.skipWs()
    return this.pos >= this.src.length
  }

  /** Peek the next non-whitespace byte (or 0 if EOF). */
  peek(): number {
    this.skipWs()
    return this.pos < this.src.length ? this.src.charCodeAt(this.pos) : 0
  }

  /** Read one path command letter (A-Z or a-z). Returns null at EOF. */
  readCmd(): string | null {
    this.skipWs()
    if (this.pos >= this.src.length) return null
    const c = this.src[this.pos]!
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      this.pos++
      return c
    }
    return null
  }

  /**
   * Read one signed real number. Throws on malformed input. SVG path numbers
   * may omit explicit separators between adjacent tokens (e.g. `1.2.3` is two
   * numbers `1.2` and `.3`); the tokenizer mirrors that quirk faithfully.
   */
  readNumber(): number {
    this.skipWs()
    const s = this.src
    const start = this.pos
    let i = start
    if (s[i] === '+' || s[i] === '-') i++
    let sawDigit = false
    let sawDot = false
    while (i < s.length) {
      const c = s.charCodeAt(i)
      if (c >= 48 && c <= 57) { sawDigit = true; i++ }
      else if (c === 46 && !sawDot) { sawDot = true; i++ }
      else break
    }
    // exponent
    if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
      i++
      if (s[i] === '+' || s[i] === '-') i++
      while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++
    }
    if (!sawDigit) {
      throw new Error(`parsePath: expected number at offset ${start}, got ${JSON.stringify(s[start] ?? 'EOF')}`)
    }
    this.pos = i
    return Number.parseFloat(s.slice(start, i))
  }

  /**
   * Read a single arc flag (exactly one '0' or '1'). Spec: arc flags are NOT
   * decimal numbers — they're a single character 0|1, so `A 1 1 0 00 5 5` is
   * legal: `00` = two flags, both 0.
   */
  readFlag(): 0 | 1 {
    this.skipWs()
    const s = this.src
    if (this.pos >= s.length) throw new Error(`parsePath: expected arc flag, got EOF`)
    const c = s[this.pos]!
    if (c !== '0' && c !== '1') {
      throw new Error(`parsePath: expected arc flag (0 or 1) at offset ${this.pos}, got ${JSON.stringify(c)}`)
    }
    this.pos++
    return c === '1' ? 1 : 0
  }
}

/**
 * Parse an SVG path `d` string into absolute-coordinate commands.
 *
 * Inlined scanner — no class dispatch, no per-number `slice()` allocation
 * (numbers are read by direct charCode-driven boundary detection then
 * `parseFloat(slice)` only once at the end of the run, since V8's
 * parseFloat over a substring is significantly faster than over the full
 * string with a starting position).
 */
export function parsePath(d: string): PathCmd[] {
  const out: PathCmd[] = []
  if (d == null || d.length === 0) return out
  const s = d
  const len = s.length
  let pos = 0
  let cx = 0, cy = 0
  let startX = 0, startY = 0
  let prevC2x = 0, prevC2y = 0
  let prevQ1x = 0, prevQ1y = 0
  let prevCmd = 0 // ASCII upper-case code; 0 = none

  // Skip whitespace + commas. Inlined.
  const skipWs = (): void => {
    while (pos < len) {
      const c = s.charCodeAt(pos)
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) pos++
      else break
    }
  }

  // Read one signed number. Throws on malformed input.
  const readNumber = (): number => {
    while (pos < len) {
      const c = s.charCodeAt(pos)
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) pos++
      else break
    }
    const start = pos
    if (pos < len) {
      const sc = s.charCodeAt(pos)
      if (sc === 43 || sc === 45) pos++
    }
    let sawDigit = false
    let sawDot = false
    while (pos < len) {
      const c = s.charCodeAt(pos)
      if (c >= 48 && c <= 57) { sawDigit = true; pos++ }
      else if (c === 46 && !sawDot) { sawDot = true; pos++ }
      else break
    }
    if (pos < len) {
      const ec = s.charCodeAt(pos)
      if (ec === 101 || ec === 69) {
        pos++
        const sc = s.charCodeAt(pos)
        if (sc === 43 || sc === 45) pos++
        while (pos < len) {
          const c = s.charCodeAt(pos)
          if (c >= 48 && c <= 57) pos++
          else break
        }
      }
    }
    if (!sawDigit) {
      throw new Error(`parsePath: expected number at offset ${start}, got ${JSON.stringify(s[start] ?? 'EOF')}`)
    }
    return Number.parseFloat(s.slice(start, pos))
  }

  // Read one arc flag (must be exactly '0' or '1'); spec: no decimal.
  const readFlag = (): 0 | 1 => {
    while (pos < len) {
      const c = s.charCodeAt(pos)
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) pos++
      else break
    }
    if (pos >= len) throw new Error(`parsePath: expected arc flag, got EOF`)
    const c = s.charCodeAt(pos)
    if (c !== 48 && c !== 49) {
      throw new Error(`parsePath: expected arc flag (0 or 1) at offset ${pos}, got ${JSON.stringify(s[pos])}`)
    }
    pos++
    return c === 49 ? 1 : 0
  }

  // True iff the next non-whitespace byte starts a number.
  const nextIsNumber = (): boolean => {
    while (pos < len) {
      const c = s.charCodeAt(pos)
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) pos++
      else break
    }
    if (pos >= len) return false
    const c = s.charCodeAt(pos)
    return (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46
  }

  while (true) {
    skipWs()
    if (pos >= len) break
    const cmdCode = s.charCodeAt(pos)
    let upperCode = cmdCode
    let rel = false
    if (cmdCode >= 97 && cmdCode <= 122) {
      upperCode = cmdCode - 32
      rel = true
    }
    else if (!(cmdCode >= 65 && cmdCode <= 90)) {
      // not a letter — bail to avoid infinite loop on garbage
      break
    }
    pos++
    let first = true

    do {
      switch (upperCode) {
        case 77: { // M
          let x = readNumber(), y = readNumber()
          if (rel) { x += cx; y += cy }
          if (first) {
            out.push({ t: 'M', x, y })
            startX = x; startY = y
          }
          else {
            out.push({ t: 'L', x, y })
          }
          cx = x; cy = y
          break
        }
        case 76: { // L
          let x = readNumber(), y = readNumber()
          if (rel) { x += cx; y += cy }
          out.push({ t: 'L', x, y })
          cx = x; cy = y
          break
        }
        case 72: { // H
          let x = readNumber()
          if (rel) x += cx
          out.push({ t: 'L', x, y: cy })
          cx = x
          break
        }
        case 86: { // V
          let y = readNumber()
          if (rel) y += cy
          out.push({ t: 'L', x: cx, y })
          cy = y
          break
        }
        case 67: { // C
          let x1 = readNumber(), y1 = readNumber()
          let x2 = readNumber(), y2 = readNumber()
          let x = readNumber(), y = readNumber()
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy }
          out.push({ t: 'C', x1, y1, x2, y2, x, y })
          prevC2x = x2; prevC2y = y2
          cx = x; cy = y
          break
        }
        case 83: { // S
          let x2 = readNumber(), y2 = readNumber()
          let x = readNumber(), y = readNumber()
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy }
          let x1 = cx, y1 = cy
          if (prevCmd === 67 /* C */ || prevCmd === 83 /* S */) {
            x1 = 2 * cx - prevC2x
            y1 = 2 * cy - prevC2y
          }
          out.push({ t: 'C', x1, y1, x2, y2, x, y })
          prevC2x = x2; prevC2y = y2
          cx = x; cy = y
          break
        }
        case 81: { // Q
          let x1 = readNumber(), y1 = readNumber()
          let x = readNumber(), y = readNumber()
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy }
          out.push({ t: 'Q', x1, y1, x, y })
          prevQ1x = x1; prevQ1y = y1
          cx = x; cy = y
          break
        }
        case 84: { // T
          let x = readNumber(), y = readNumber()
          if (rel) { x += cx; y += cy }
          let x1 = cx, y1 = cy
          if (prevCmd === 81 /* Q */ || prevCmd === 84 /* T */) {
            x1 = 2 * cx - prevQ1x
            y1 = 2 * cy - prevQ1y
          }
          out.push({ t: 'Q', x1, y1, x, y })
          prevQ1x = x1; prevQ1y = y1
          cx = x; cy = y
          break
        }
        case 65: { // A
          const rx = Math.abs(readNumber())
          const ry = Math.abs(readNumber())
          const rot = readNumber()
          const largeArc = readFlag() === 1
          const sweep = readFlag() === 1
          let x = readNumber(), y = readNumber()
          if (rel) { x += cx; y += cy }
          out.push({ t: 'A', rx, ry, xAxisRot: rot, largeArc, sweep, x, y })
          cx = x; cy = y
          break
        }
        case 90: { // Z
          out.push({ t: 'Z' })
          cx = startX; cy = startY
          break
        }
        default:
          throw new Error(`parsePath: unknown command ${JSON.stringify(String.fromCharCode(cmdCode))}`)
      }
      prevCmd = upperCode
      first = false
      if (upperCode === 90) break
    }
    while (nextIsNumber())
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

// Reused stack for iterative cubic flattening — 9 numbers per frame:
//   x0,y0, c1x,c1y, c2x,c2y, x1,y1, depth
// Capacity grows on demand; each `flattenCubic` call grows-and-shrinks.
const CUBIC_STACK_FRAME = 9
const cubicStack: number[] = []

/**
 * Adaptive subdivision of a cubic Bezier into line segments.
 *
 * Iterative: uses a shared work-stack instead of recursion. For a path with
 * N hard cubics, this avoids O(N × depth) function-call frames in V8 and
 * lets the engine specialize the inner loop on monomorphic Float64 ops.
 *
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
  const stack = cubicStack
  let sp = stack.length
  // Push the initial frame.
  stack.push(x0, y0, c1x, c1y, c2x, c2y, x1, y1, depth)
  const baseSp = sp
  while (stack.length > baseSp) {
    const top = stack.length - CUBIC_STACK_FRAME
    const fx0 = stack[top]!, fy0 = stack[top + 1]!
    const fc1x = stack[top + 2]!, fc1y = stack[top + 3]!
    const fc2x = stack[top + 4]!, fc2y = stack[top + 5]!
    const fx1 = stack[top + 6]!, fy1 = stack[top + 7]!
    const fdepth = stack[top + 8]!
    stack.length = top

    if (fdepth >= MAX_FLATTEN_DEPTH) { out.push(fx1, fy1); continue }
    const dx = fx1 - fx0
    const dy = fy1 - fy0
    const denom = dx * dx + dy * dy
    let d1: number, d2: number
    if (denom === 0) {
      d1 = Math.hypot(fc1x - fx0, fc1y - fy0)
      d2 = Math.hypot(fc2x - fx1, fc2y - fy1)
    }
    else {
      const inv = 1 / Math.sqrt(denom)
      const a1 = (fc1x - fx1) * dy - (fc1y - fy1) * dx
      const a2 = (fc2x - fx1) * dy - (fc2y - fy1) * dx
      d1 = (a1 < 0 ? -a1 : a1) * inv
      d2 = (a2 < 0 ? -a2 : a2) * inv
    }
    if ((d1 > d2 ? d1 : d2) <= tolerance) {
      out.push(fx1, fy1)
      continue
    }
    // De Casteljau split at t=0.5.
    const m12x = (fx0 + fc1x) * 0.5, m12y = (fy0 + fc1y) * 0.5
    const m23x = (fc1x + fc2x) * 0.5, m23y = (fc1y + fc2y) * 0.5
    const m34x = (fc2x + fx1) * 0.5, m34y = (fc2y + fy1) * 0.5
    const m123x = (m12x + m23x) * 0.5, m123y = (m12y + m23y) * 0.5
    const m234x = (m23x + m34x) * 0.5, m234y = (m23y + m34y) * 0.5
    const mx = (m123x + m234x) * 0.5, my = (m123y + m234y) * 0.5
    // Push RIGHT half first so LEFT half is processed first (LIFO).
    stack.push(mx, my, m234x, m234y, m34x, m34y, fx1, fy1, fdepth + 1)
    stack.push(fx0, fy0, m12x, m12y, m123x, m123y, mx, my, fdepth + 1)
  }
}

const QUAD_STACK_FRAME = 7
const quadStack: number[] = []

/** Adaptive subdivision of a quadratic Bezier into line segments. */
export function flattenQuadratic(
  x0: number, y0: number,
  c1x: number, c1y: number,
  x1: number, y1: number,
  tolerance: number,
  out: number[],
  depth = 0,
): void {
  const stack = quadStack
  const baseSp = stack.length
  stack.push(x0, y0, c1x, c1y, x1, y1, depth)
  while (stack.length > baseSp) {
    const top = stack.length - QUAD_STACK_FRAME
    const fx0 = stack[top]!, fy0 = stack[top + 1]!
    const fc1x = stack[top + 2]!, fc1y = stack[top + 3]!
    const fx1 = stack[top + 4]!, fy1 = stack[top + 5]!
    const fdepth = stack[top + 6]!
    stack.length = top
    if (fdepth >= MAX_FLATTEN_DEPTH) { out.push(fx1, fy1); continue }
    const dx = fx1 - fx0, dy = fy1 - fy0
    const denom = dx * dx + dy * dy
    const d = denom === 0
      ? Math.hypot(fc1x - fx0, fc1y - fy0)
      : Math.abs((fc1x - fx1) * dy - (fc1y - fy1) * dx) / Math.sqrt(denom)
    if (d <= tolerance) {
      out.push(fx1, fy1)
      continue
    }
    const m12x = (fx0 + fc1x) * 0.5, m12y = (fy0 + fc1y) * 0.5
    const m23x = (fc1x + fx1) * 0.5, m23y = (fc1y + fy1) * 0.5
    const mx = (m12x + m23x) * 0.5
    const my = (m12y + m23y) * 0.5
    stack.push(mx, my, m23x, m23y, fx1, fy1, fdepth + 1)
    stack.push(fx0, fy0, m12x, m12y, mx, my, fdepth + 1)
  }
}

/**
 * A flattened sub-path: the polyline points plus whether the original
 * sub-path ended in `Z` (closepath).
 */
export interface FlatContour {
  points: number[]
  closed: boolean
}

/**
 * Flatten a sequence of path commands into a list of contours. Cubics,
 * quadratics and arcs are tessellated to `tolerance` pixels.
 *
 * Each contour records its `closed` flag so the stroke pass can choose
 * caps for open paths and joins-around for closed paths. This matters
 * for SVGs like `M … Z L …` where a draw command follows a closepath
 * — it opens a new sub-path anchored at the previous start, but the
 * new sub-path is open (no implicit closure).
 */
export function flattenCommands(cmds: PathCmd[], tolerance = 0.25): FlatContour[] {
  const contours: FlatContour[] = []
  let current: FlatContour | null = null
  let cx = 0, cy = 0
  let startX = 0, startY = 0
  for (const c of cmds) {
    switch (c.t) {
      case 'M':
        current = { points: [c.x, c.y], closed: false }
        contours.push(current)
        cx = c.x; cy = c.y
        startX = c.x; startY = c.y
        break
      case 'L':
        if (!current) break
        current.points.push(c.x, c.y)
        cx = c.x; cy = c.y
        break
      case 'C':
        if (!current) break
        flattenCubic(cx, cy, c.x1, c.y1, c.x2, c.y2, c.x, c.y, tolerance, current.points)
        cx = c.x; cy = c.y
        break
      case 'Q':
        if (!current) break
        flattenQuadratic(cx, cy, c.x1, c.y1, c.x, c.y, tolerance, current.points)
        cx = c.x; cy = c.y
        break
      case 'A': {
        if (!current) break
        const cubics = arcToCubics(cx, cy, c.rx, c.ry, c.xAxisRot, c.largeArc, c.sweep, c.x, c.y)
        for (const cu of cubics) {
          flattenCubic(cx, cy, cu.c1x, cu.c1y, cu.c2x, cu.c2y, cu.x, cu.y, tolerance, current.points)
          cx = cu.x; cy = cu.y
        }
        break
      }
      case 'Z':
        if (current) {
          current.points.push(startX, startY)
          current.closed = true
        }
        cx = startX; cy = startY
        // Open a new contour anchored at the subpath start so any draw
        // commands following Z (without an explicit M) still render.
        current = { points: [startX, startY], closed: false }
        contours.push(current)
        break
    }
  }
  return contours.filter(c => c.points.length >= 4)
}
