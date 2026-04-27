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

/** Parse an SVG path `d` string into absolute-coordinate commands. */
export function parsePath(d: string): PathCmd[] {
  const out: PathCmd[] = []
  let cx = 0, cy = 0 // current point
  let startX = 0, startY = 0 // subpath start
  let prevC2x = 0, prevC2y = 0 // previous cubic control2 (for S/s)
  let prevQ1x = 0, prevQ1y = 0 // previous quadratic control1 (for T/t)
  let prevCmd = ''
  const lex = new PathLex(d)

  /** Detect whether the next non-whitespace char is the start of a number
   * (digit, sign, or decimal point) — used to honour the implicit-repeat
   * rule (e.g. `M 0 0 10 10` = `M 0 0 L 10 10`). */
  const nextIsNumber = (): boolean => {
    const c = lex.peek()
    return (c >= 48 && c <= 57) || c === 43 /* + */ || c === 45 /* - */ || c === 46 /* . */
  }

  while (true) {
    const cmd = lex.readCmd()
    if (cmd == null) break
    const rel = cmd === cmd.toLowerCase()
    const upper = cmd.toUpperCase()
    let first = true

    do {
      switch (upper) {
        case 'M': {
          let x = lex.readNumber(), y = lex.readNumber()
          if (rel) { x += cx; y += cy }
          if (first) {
            out.push({ t: 'M', x, y })
            startX = x; startY = y
          }
          else {
            // Implicit lineto after the first M coord pair
            out.push({ t: 'L', x, y })
          }
          cx = x; cy = y
          break
        }
        case 'L': {
          let x = lex.readNumber(), y = lex.readNumber()
          if (rel) { x += cx; y += cy }
          out.push({ t: 'L', x, y })
          cx = x; cy = y
          break
        }
        case 'H': {
          let x = lex.readNumber()
          if (rel) x += cx
          out.push({ t: 'L', x, y: cy })
          cx = x
          break
        }
        case 'V': {
          let y = lex.readNumber()
          if (rel) y += cy
          out.push({ t: 'L', x: cx, y })
          cy = y
          break
        }
        case 'C': {
          let x1 = lex.readNumber(), y1 = lex.readNumber()
          let x2 = lex.readNumber(), y2 = lex.readNumber()
          let x = lex.readNumber(), y = lex.readNumber()
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy }
          out.push({ t: 'C', x1, y1, x2, y2, x, y })
          prevC2x = x2; prevC2y = y2
          cx = x; cy = y
          break
        }
        case 'S': {
          let x2 = lex.readNumber(), y2 = lex.readNumber()
          let x = lex.readNumber(), y = lex.readNumber()
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy }
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
          let x1 = lex.readNumber(), y1 = lex.readNumber()
          let x = lex.readNumber(), y = lex.readNumber()
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy }
          out.push({ t: 'Q', x1, y1, x, y })
          prevQ1x = x1; prevQ1y = y1
          cx = x; cy = y
          break
        }
        case 'T': {
          let x = lex.readNumber(), y = lex.readNumber()
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
          // SVG spec: rx, ry are non-negative numbers; rot is any number;
          // largeArc and sweep are EXACTLY one character '0' or '1' (no
          // implicit decimal absorption — `A1 1 0 00 5 5` is valid).
          const rx = Math.abs(lex.readNumber())
          const ry = Math.abs(lex.readNumber())
          const rot = lex.readNumber()
          const largeArc = lex.readFlag() === 1
          const sweep = lex.readFlag() === 1
          let x = lex.readNumber(), y = lex.readNumber()
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
        default:
          throw new Error(`parsePath: unknown command ${JSON.stringify(cmd)}`)
      }
      prevCmd = upper
      first = false
      if (upper === 'Z') break
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
