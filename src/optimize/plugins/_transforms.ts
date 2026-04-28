/**
 * Parses, decomposes, and stringifies SVG `transform` attributes.
 * Adapted from SVGO's plugins/_transforms.js (MIT).
 */

import type { CleanupOutDataParams } from '../tools'
import { cleanupOutData, toFixed } from '../tools'

export interface TransformItem {
  name: string
  data: number[]
}

export interface TransformParams extends CleanupOutDataParams {
  convertToShorts: boolean
  degPrecision?: number
  floatPrecision: number
  transformPrecision: number
  matrixToTransform: boolean
  shortTranslate: boolean
  shortScale: boolean
  shortRotate: boolean
  removeUseless: boolean
  collapseIntoOne: boolean
  leadingZero: boolean
  negativeExtraSpace: boolean
}

const transformTypes = new Set(['matrix', 'rotate', 'scale', 'skewX', 'skewY', 'translate'])

const regTransformSplit = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*(.+?)\s*\)[\s,]*/
const regNumericValues = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g

export function transform2js(transformString: string): TransformItem[] {
  const transforms: TransformItem[] = []
  let currentTransform: TransformItem | null = null

  for (const item of transformString.split(regTransformSplit)) {
    if (!item)
      continue
    if (transformTypes.has(item)) {
      currentTransform = { name: item, data: [] }
      transforms.push(currentTransform)
    }
    else {
      let m: RegExpExecArray | null
      regNumericValues.lastIndex = 0
      while ((m = regNumericValues.exec(item)) != null) {
        const num = Number(m[0])
        if (currentTransform != null)
          currentTransform.data.push(num)
      }
    }
  }

  return currentTransform == null || currentTransform.data.length === 0 ? [] : transforms
}

export function transformsMultiply(transforms: ReadonlyArray<TransformItem>): TransformItem {
  const matrixData = transforms.map(t => t.name === 'matrix' ? t.data : transformToMatrix(t))
  return {
    name: 'matrix',
    data: matrixData.length > 0 ? matrixData.reduce(multiplyTransformMatrices) : [],
  }
}

const mth = {
  rad: (deg: number): number => (deg * Math.PI) / 180,
  deg: (rad: number): number => (rad * 180) / Math.PI,
  cos: (deg: number): number => Math.cos(mth.rad(deg)),
  acos: (val: number, fp: number): number => toFixed(mth.deg(Math.acos(val)), fp),
  sin: (deg: number): number => Math.sin(mth.rad(deg)),
  asin: (val: number, fp: number): number => toFixed(mth.deg(Math.asin(val)), fp),
  tan: (deg: number): number => Math.tan(mth.rad(deg)),
  atan: (val: number, fp: number): number => toFixed(mth.deg(Math.atan(val)), fp),
}

function getDecompositions(matrix: TransformItem): TransformItem[][] {
  const decompositions: TransformItem[][] = []
  const qrab = decomposeQRAB(matrix)
  const qrcd = decomposeQRCD(matrix)
  if (qrab)
    decompositions.push(qrab)
  if (qrcd)
    decompositions.push(qrcd)
  return decompositions
}

function decomposeQRAB(matrix: TransformItem): TransformItem[] | undefined {
  const data = matrix.data
  const a = data[0]!, b = data[1]!, c = data[2]!, d = data[3]!, e = data[4]!, f = data[5]!
  const delta = a * d - b * c
  if (delta === 0)
    return
  const r = Math.hypot(a, b)
  if (r === 0)
    return

  const decomposition: TransformItem[] = []
  const cosOfRotationAngle = a / r

  if (e || f)
    decomposition.push({ name: 'translate', data: [e, f] })

  if (cosOfRotationAngle !== 1) {
    const rotationAngleRads = Math.acos(cosOfRotationAngle)
    decomposition.push({
      name: 'rotate',
      data: [mth.deg(b < 0 ? -rotationAngleRads : rotationAngleRads), 0, 0],
    })
  }

  const sx = r
  const sy = delta / sx
  if (sx !== 1 || sy !== 1)
    decomposition.push({ name: 'scale', data: [sx, sy] })

  const acPlusBd = a * c + b * d
  if (acPlusBd) {
    decomposition.push({
      name: 'skewX',
      data: [mth.deg(Math.atan(acPlusBd / (a * a + b * b)))],
    })
  }
  return decomposition
}

function decomposeQRCD(matrix: TransformItem): TransformItem[] | undefined {
  const data = matrix.data
  const a = data[0]!, b = data[1]!, c = data[2]!, d = data[3]!, e = data[4]!, f = data[5]!
  const delta = a * d - b * c
  if (delta === 0)
    return
  const s = Math.hypot(c, d)
  if (s === 0)
    return

  const decomposition: TransformItem[] = []
  if (e || f)
    decomposition.push({ name: 'translate', data: [e, f] })

  const rotationAngleRads = Math.PI / 2 - (d < 0 ? -1 : 1) * Math.acos(-c / s)
  decomposition.push({ name: 'rotate', data: [mth.deg(rotationAngleRads), 0, 0] })

  const sx = delta / s
  const sy = s
  if (sx !== 1 || sy !== 1)
    decomposition.push({ name: 'scale', data: [sx, sy] })

  const acPlusBd = a * c + b * d
  if (acPlusBd) {
    decomposition.push({
      name: 'skewY',
      data: [mth.deg(Math.atan(acPlusBd / (c * c + d * d)))],
    })
  }
  return decomposition
}

function mergeTranslateAndRotate(tx: number, ty: number, a: number): TransformItem {
  const rotationAngleRads = mth.rad(a)
  const d = 1 - Math.cos(rotationAngleRads)
  const e = Math.sin(rotationAngleRads)
  const cy = (d * ty + e * tx) / (d * d + e * e)
  const cx = (tx - e * cy) / d
  return { name: 'rotate', data: [a, cx, cy] }
}

function isIdentityTransform(t: TransformItem): boolean {
  switch (t.name) {
    case 'rotate':
    case 'skewX':
    case 'skewY':
      return t.data[0] === 0
    case 'scale':
      return t.data[0] === 1 && t.data[1] === 1
    case 'translate':
      return t.data[0] === 0 && t.data[1] === 0
  }
  return false
}

function optimize(roundedTransforms: ReadonlyArray<TransformItem>, rawTransforms: ReadonlyArray<TransformItem>): TransformItem[] {
  const out: TransformItem[] = []
  for (let i = 0; i < roundedTransforms.length; i++) {
    const rt = roundedTransforms[i]!
    if (isIdentityTransform(rt))
      continue
    const data = rt.data
    switch (rt.name) {
      case 'rotate':
        switch (data[0]) {
          case 180:
          case -180: {
            const next = roundedTransforms[i + 1]
            if (next && next.name === 'scale') {
              out.push(createScaleTransform(next.data.map(v => -v)))
              i++
            }
            else {
              out.push({ name: 'scale', data: [-1] })
            }
            continue
          }
        }
        out.push({ name: 'rotate', data: data.slice(0, data[1] || data[2] ? 3 : 1) })
        break
      case 'scale':
        out.push(createScaleTransform(data))
        break
      case 'skewX':
      case 'skewY':
        out.push({ name: rt.name, data: [data[0]!] })
        break
      case 'translate': {
        const next = roundedTransforms[i + 1]
        if (
          next
          && next.name === 'rotate'
          && next.data[0] !== 180
          && next.data[0] !== -180
          && next.data[0] !== 0
          && next.data[1] === 0
          && next.data[2] === 0
        ) {
          const rd = rawTransforms[i]!.data
          out.push(mergeTranslateAndRotate(rd[0]!, rd[1]!, rawTransforms[i + 1]!.data[0]!))
          i++
          continue
        }
        out.push({ name: 'translate', data: data.slice(0, data[1] ? 2 : 1) })
        break
      }
    }
  }
  return out.length ? out : [{ name: 'scale', data: [1] }]
}

function createScaleTransform(data: ReadonlyArray<number>): TransformItem {
  return { name: 'scale', data: data.slice(0, data[0] === data[1] ? 1 : 2) }
}

export function matrixToTransform(origMatrix: TransformItem, params: TransformParams): TransformItem[] {
  const decomposed = getDecompositions(origMatrix)
  let shortest: TransformItem[] | undefined
  let shortestLen = Number.MAX_VALUE

  for (const decomposition of decomposed) {
    const roundedTransforms = decomposition.map((ti) => {
      const copy = { name: ti.name, data: [...ti.data] }
      return roundTransform(copy, params)
    })
    const optimized = optimize(roundedTransforms, decomposition)
    const len = js2transform(optimized, params).length
    if (len < shortestLen) {
      shortest = optimized
      shortestLen = len
    }
  }

  return shortest ?? [origMatrix]
}

function transformToMatrix(transform: TransformItem): number[] {
  if (transform.name === 'matrix')
    return transform.data
  switch (transform.name) {
    case 'translate':
      return [1, 0, 0, 1, transform.data[0]!, transform.data[1] || 0]
    case 'scale':
      return [transform.data[0]!, 0, 0, transform.data[1] ?? transform.data[0]!, 0, 0]
    case 'rotate': {
      const cos = mth.cos(transform.data[0]!)
      const sin = mth.sin(transform.data[0]!)
      const cx = transform.data[1] || 0
      const cy = transform.data[2] || 0
      return [cos, sin, -sin, cos, (1 - cos) * cx + sin * cy, (1 - cos) * cy - sin * cx]
    }
    case 'skewX':
      return [1, 0, mth.tan(transform.data[0]!), 1, 0, 0]
    case 'skewY':
      return [1, mth.tan(transform.data[0]!), 0, 1, 0, 0]
    default:
      throw new Error(`Unknown transform ${transform.name}`)
  }
}

export function transformArc(cursor: [number, number], arc: number[], transform: ReadonlyArray<number>): number[] {
  const x = arc[5]! - cursor[0]
  const y = arc[6]! - cursor[1]
  let a = arc[0]!
  let b = arc[1]!
  const rot = (arc[2]! * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  if (a > 0 && b > 0) {
    let h = (x * cos + y * sin) ** 2 / (4 * a * a) + (y * cos - x * sin) ** 2 / (4 * b * b)
    if (h > 1) {
      h = Math.sqrt(h)
      a *= h
      b *= h
    }
  }
  const ellipse = [a * cos, a * sin, -b * sin, b * cos, 0, 0]
  const m = multiplyTransformMatrices(transform, ellipse)
  const lastCol = m[2]! * m[2]! + m[3]! * m[3]!
  const squareSum = m[0]! * m[0]! + m[1]! * m[1]! + lastCol
  const root = Math.hypot(m[0]! - m[3]!, m[1]! + m[2]!) * Math.hypot(m[0]! + m[3]!, m[1]! - m[2]!)

  if (!root) {
    arc[0] = arc[1] = Math.sqrt(squareSum / 2)
    arc[2] = 0
  }
  else {
    const majorAxisSqr = (squareSum + root) / 2
    const minorAxisSqr = (squareSum - root) / 2
    const major = Math.abs(majorAxisSqr - lastCol) > 1e-6
    const sub = (major ? majorAxisSqr : minorAxisSqr) - lastCol
    const rowsSum = m[0]! * m[2]! + m[1]! * m[3]!
    const term1 = m[0]! * sub + m[2]! * rowsSum
    const term2 = m[1]! * sub + m[3]! * rowsSum
    arc[0] = Math.sqrt(majorAxisSqr)
    arc[1] = Math.sqrt(minorAxisSqr)
    arc[2]
      = (((major ? term2 < 0 : term1 > 0) ? -1 : 1)
        * Math.acos((major ? term1 : term2) / Math.hypot(term1, term2))
        * 180)
        / Math.PI
  }

  if ((transform[0]! < 0) !== (transform[3]! < 0)) {
    // Flip sweep flag if x or y is mirrored (XOR)
    arc[4] = 1 - arc[4]!
  }
  return arc
}

function multiplyTransformMatrices(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number[] {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!,
    a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!,
    a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
    a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
  ]
}

export function roundTransform(transform: TransformItem, params: TransformParams): TransformItem {
  switch (transform.name) {
    case 'translate':
      transform.data = floatRound(transform.data, params)
      break
    case 'rotate':
      transform.data = [...degRound(transform.data.slice(0, 1), params), ...floatRound(transform.data.slice(1), params)]
      break
    case 'skewX':
    case 'skewY':
      transform.data = degRound(transform.data, params)
      break
    case 'scale':
      transform.data = transformRound(transform.data, params)
      break
    case 'matrix':
      transform.data = [
        ...transformRound(transform.data.slice(0, 4), params),
        ...floatRound(transform.data.slice(4), params),
      ]
      break
  }
  return transform
}

function degRound(data: number[], params: TransformParams): number[] {
  if (params.degPrecision != null && params.degPrecision >= 1 && params.floatPrecision < 20)
    return smartRound(params.degPrecision, data)
  return round(data)
}

function floatRound(data: number[], params: TransformParams): number[] {
  if (params.floatPrecision >= 1 && params.floatPrecision < 20)
    return smartRound(params.floatPrecision, data)
  return round(data)
}

function transformRound(data: number[], params: TransformParams): number[] {
  if (params.transformPrecision >= 1 && params.floatPrecision < 20)
    return smartRound(params.transformPrecision, data)
  return round(data)
}

function round(data: ReadonlyArray<number>): number[] {
  return data.map(Math.round)
}

function smartRound(precision: number, data: number[]): number[] {
  const tolerance = +(0.1 ** precision).toFixed(precision)
  for (let i = data.length; i--;) {
    if (toFixed(data[i]!, precision) !== data[i]) {
      const rounded = +data[i]!.toFixed(precision - 1)
      data[i]
        = +Math.abs(rounded - data[i]!).toFixed(precision + 1) >= tolerance
          ? +data[i]!.toFixed(precision)
          : rounded
    }
  }
  return data
}

export function js2transform(transformJS: ReadonlyArray<TransformItem>, params: TransformParams): string {
  return transformJS
    .map((t) => {
      roundTransform(t, params)
      return `${t.name}(${cleanupOutData(t.data, params)})`
    })
    .join('')
}
