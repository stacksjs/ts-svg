/**
 * SVG transform parser + composition helpers.
 *
 *   transform="translate(10 20) rotate(45) scale(2)"
 *
 * The result is always a single composed 2x3 affine matrix.
 */

import type { Matrix } from './types'

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(a: Matrix, b: Matrix): Matrix {
  // Identity short-circuits: a 6-element array allocation is non-trivial when
  // it happens once per parser node and once per render-tree visit. The
  // identity case dominates because most styled-attr-free groups inherit
  // IDENTITY from their parent.
  if (a === IDENTITY) return b
  if (b === IDENTITY) return a
  // Right-multiplied: result = a * b, applied as p' = a(b(p))
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Invert a 2x3 affine. Returns null if the matrix is singular. */
export function invertMatrix(m: Matrix): Matrix | null {
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

function translate(tx: number, ty = 0): Matrix {
  return [1, 0, 0, 1, tx, ty]
}

function scale(sx: number, sy?: number): Matrix {
  return [sx, 0, 0, sy ?? sx, 0, 0]
}

function rotate(deg: number, cx = 0, cy = 0): Matrix {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r), s = Math.sin(r)
  if (cx === 0 && cy === 0) return [c, s, -s, c, 0, 0]
  // rotate around (cx, cy) = T(cx,cy) * R * T(-cx,-cy)
  return multiply(translate(cx, cy), multiply([c, s, -s, c, 0, 0], translate(-cx, -cy)))
}

function skewX(deg: number): Matrix {
  return [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0]
}

function skewY(deg: number): Matrix {
  return [1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0]
}

/**
 * Parse `transform="..."` attribute value into a single composed matrix.
 *
 * Hand-rolled scanner — no regex, no per-call array allocations beyond the
 * argument list itself. Tokens look like: `name([num1[,] num2 ...])` with
 * any whitespace allowed.
 */
export function parseTransform(s: string): Matrix {
  if (s == null || s.length === 0) return IDENTITY
  const len = s.length
  let i = 0
  let result: Matrix = IDENTITY
  const args: number[] = []

  while (i < len) {
    // skip whitespace and commas
    let c = s.charCodeAt(i)
    while (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) {
      i++
      if (i >= len) return result
      c = s.charCodeAt(i)
    }
    // function name
    const nameStart = i
    while (i < len) {
      const cc = s.charCodeAt(i)
      // a-z A-Z only
      if ((cc >= 97 && cc <= 122) || (cc >= 65 && cc <= 90)) i++
      else break
    }
    if (i === nameStart) break
    const fn = s.slice(nameStart, i)
    // skip whitespace before '('
    while (i < len) {
      const cc = s.charCodeAt(i)
      if (cc === 32 || cc === 9 || cc === 10 || cc === 13) i++
      else break
    }
    if (s.charCodeAt(i) !== 40 /* ( */) break
    i++
    args.length = 0
    // parse numbers until ')'
    while (i < len) {
      let cc = s.charCodeAt(i)
      while (cc === 32 || cc === 9 || cc === 10 || cc === 13 || cc === 44) {
        i++
        if (i >= len) break
        cc = s.charCodeAt(i)
      }
      if (cc === 41 /* ) */) { i++; break }
      // read a number — allow leading +/-, digits, '.', exponent
      const numStart = i
      if (cc === 43 || cc === 45) { i++; cc = s.charCodeAt(i) }
      let sawDigit = false
      while (i < len) {
        const dc = s.charCodeAt(i)
        if (dc >= 48 && dc <= 57) { sawDigit = true; i++ }
        else if (dc === 46) { i++ } // '.'
        else break
      }
      if (i < len) {
        const ec = s.charCodeAt(i)
        if (ec === 101 || ec === 69) {
          i++
          const sc = s.charCodeAt(i)
          if (sc === 43 || sc === 45) i++
          while (i < len && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++
        }
      }
      if (!sawDigit) break
      args.push(Number.parseFloat(s.slice(numStart, i)))
    }

    let next: Matrix
    switch (fn) {
      case 'matrix':
        next = args.length === 6 ? [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!] : IDENTITY
        break
      case 'translate':
        next = translate(args[0] ?? 0, args[1] ?? 0)
        break
      case 'scale':
        next = scale(args[0] ?? 1, args[1])
        break
      case 'rotate':
        next = rotate(args[0] ?? 0, args[1], args[2])
        break
      case 'skewX':
        next = skewX(args[0] ?? 0)
        break
      case 'skewY':
        next = skewY(args[0] ?? 0)
        break
      default:
        next = IDENTITY
    }
    result = result === IDENTITY ? next : multiply(result, next)
  }
  return result
}
