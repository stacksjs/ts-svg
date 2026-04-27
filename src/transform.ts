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

/** Parse `transform="..."` attribute value into a single composed matrix. */
export function parseTransform(s: string): Matrix {
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  let result: Matrix = IDENTITY
  while ((m = re.exec(s)) != null) {
    const fn = m[1]!
    const args = m[2]!.split(/[\s,]+/).filter(Boolean).map(Number)
    let next: Matrix
    switch (fn) {
      case 'matrix':
        next = args.length === 6
          ? [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]
          : IDENTITY
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
    result = multiply(result, next)
  }
  return result
}
