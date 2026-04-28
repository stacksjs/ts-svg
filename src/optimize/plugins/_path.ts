/**
 * Path-data helpers shared between geometry plugins.
 *
 * `path2js` / `js2path` round-trip a `<path d="…">` to and from a
 * normalised array of `{command, args}` items. `intersects` is a
 * Gilbert–Johnson–Keerthi convex-hull check used by mergePaths.
 *
 * Adapted from SVGO's plugins/_path.js (MIT).
 */

import type { PathDataCommand, PathDataItem, XastElement } from '../types'
import { parsePathData, stringifyPathData } from '../path'

export interface Js2PathParams {
  floatPrecision?: number
  noSpaceAfterFlags?: boolean
}

interface PathPoint {
  list: number[][]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Points {
  list: PathPoint[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

let prevCtrlPoint: [number, number] = [0, 0]

interface PathWithCache extends XastElement {
  pathJS?: PathDataItem[]
}

export function path2js(path: XastElement): PathDataItem[] {
  const cached = (path as PathWithCache).pathJS
  if (cached)
    return cached

  const pathData: PathDataItem[] = []
  const newPathData = parsePathData(path.attributes.d ?? '')
  for (const { command, args } of newPathData)
    pathData.push({ command, args })

  // Leading "m" is treated as absolute by the spec — readPathData keeps it
  // lowercase, so canonicalise here.
  if (pathData.length && pathData[0]!.command === 'm')
    pathData[0]!.command = 'M'

  ;(path as PathWithCache).pathJS = pathData
  return pathData
}

export function convertRelativeToAbsolute(data: ReadonlyArray<PathDataItem>): PathDataItem[] {
  const newData: PathDataItem[] = []
  const start: [number, number] = [0, 0]
  const cursor: [number, number] = [0, 0]

  for (const item of data) {
    let command: PathDataCommand = item.command
    let args = item.args.slice()

    if (command === 'm') {
      args[0]! += cursor[0]
      args[1]! += cursor[1]
      command = 'M'
    }
    if (command === 'M') {
      cursor[0] = args[0]!
      cursor[1] = args[1]!
      start[0] = cursor[0]
      start[1] = cursor[1]
    }

    if (command === 'h') {
      args[0]! += cursor[0]
      command = 'H'
    }
    if (command === 'H')
      cursor[0] = args[0]!

    if (command === 'v') {
      args[0]! += cursor[1]
      command = 'V'
    }
    if (command === 'V')
      cursor[1] = args[0]!

    if (command === 'l') {
      args[0]! += cursor[0]
      args[1]! += cursor[1]
      command = 'L'
    }
    if (command === 'L') {
      cursor[0] = args[0]!
      cursor[1] = args[1]!
    }

    if (command === 'c') {
      args[0]! += cursor[0]
      args[1]! += cursor[1]
      args[2]! += cursor[0]
      args[3]! += cursor[1]
      args[4]! += cursor[0]
      args[5]! += cursor[1]
      command = 'C'
    }
    if (command === 'C') {
      cursor[0] = args[4]!
      cursor[1] = args[5]!
    }

    if (command === 's') {
      args[0]! += cursor[0]
      args[1]! += cursor[1]
      args[2]! += cursor[0]
      args[3]! += cursor[1]
      command = 'S'
    }
    if (command === 'S') {
      cursor[0] = args[2]!
      cursor[1] = args[3]!
    }

    if (command === 'q') {
      args[0]! += cursor[0]
      args[1]! += cursor[1]
      args[2]! += cursor[0]
      args[3]! += cursor[1]
      command = 'Q'
    }
    if (command === 'Q') {
      cursor[0] = args[2]!
      cursor[1] = args[3]!
    }

    if (command === 't') {
      args[0]! += cursor[0]
      args[1]! += cursor[1]
      command = 'T'
    }
    if (command === 'T') {
      cursor[0] = args[0]!
      cursor[1] = args[1]!
    }

    if (command === 'a') {
      args[5]! += cursor[0]
      args[6]! += cursor[1]
      command = 'A'
    }
    if (command === 'A') {
      cursor[0] = args[5]!
      cursor[1] = args[6]!
    }

    if (command === 'z' || command === 'Z') {
      cursor[0] = start[0]
      cursor[1] = start[1]
      command = 'z'
      args = []
    }

    newData.push({ command, args })
  }
  return newData
}

export function js2path(path: XastElement, data: ReadonlyArray<PathDataItem>, params: Js2PathParams): void {
  ;(path as PathWithCache).pathJS = data as PathDataItem[]

  const pathData: PathDataItem[] = []
  for (const item of data) {
    if (pathData.length !== 0 && (item.command === 'M' || item.command === 'm')) {
      const last = pathData[pathData.length - 1]!
      if (last.command === 'M' || last.command === 'm')
        pathData.pop()
    }
    pathData.push({ command: item.command, args: item.args })
  }

  path.attributes.d = stringifyPathData({
    pathData,
    precision: params.floatPrecision,
    disableSpaceAfterFlags: params.noSpaceAfterFlags,
  })
}

function set(dest: number[], source: ReadonlyArray<number>): number[] {
  dest[0] = source[source.length - 2]!
  dest[1] = source[source.length - 1]!
  return dest
}

export function intersects(path1: ReadonlyArray<PathDataItem>, path2: ReadonlyArray<PathDataItem>): boolean {
  const points1 = gatherPoints(convertRelativeToAbsolute(path1))
  const points2 = gatherPoints(convertRelativeToAbsolute(path2))

  if (
    points1.maxX <= points2.minX
    || points2.maxX <= points1.minX
    || points1.maxY <= points2.minY
    || points2.maxY <= points1.minY
    || points1.list.every(set1 => points2.list.every(set2 =>
      set1.list[set1.maxX]![0]! <= set2.list[set2.minX]![0]!
      || set2.list[set2.maxX]![0]! <= set1.list[set1.minX]![0]!
      || set1.list[set1.maxY]![1]! <= set2.list[set2.minY]![1]!
      || set2.list[set2.maxY]![1]! <= set1.list[set1.minY]![1]!,
    ))
  ) {
    return false
  }

  const hullNest1 = points1.list.map(convexHull)
  const hullNest2 = points2.list.map(convexHull)

  return hullNest1.some((hull1) => {
    if (hull1.list.length < 3)
      return false
    return hullNest2.some((hull2) => {
      if (hull2.list.length < 3)
        return false

      const simplex: number[][] = [getSupport(hull1, hull2, [1, 0])]
      const direction = minus(simplex[0]!)
      let iterations = 1e4
      while (true) {
        if (iterations-- === 0) {
          console.error('Error: infinite loop while processing mergePaths plugin.')
          return true
        }
        simplex.push(getSupport(hull1, hull2, direction))
        if (dot(direction, simplex[simplex.length - 1]!) <= 0)
          return false
        if (processSimplex(simplex, direction))
          return true
      }
    })
  })

  function getSupport(a: PathPoint, b: PathPoint, direction: ReadonlyArray<number>): number[] {
    return sub(supportPoint(a, direction), supportPoint(b, minus(direction)))
  }

  function supportPoint(polygon: PathPoint, direction: ReadonlyArray<number>): number[] {
    let index
      = direction[1]! >= 0
        ? direction[0]! < 0
          ? polygon.maxY
          : polygon.maxX
        : direction[0]! < 0
          ? polygon.minX
          : polygon.minY
    let max = -Infinity
    let value: number
    while ((value = dot(polygon.list[index]!, direction)) > max) {
      max = value
      index = ++index % polygon.list.length
    }
    return polygon.list[(index || polygon.list.length) - 1]!
  }
}

function processSimplex(simplex: number[][], direction: number[]): boolean {
  if (simplex.length === 2) {
    const a = simplex[1]!
    const b = simplex[0]!
    const AO = minus(simplex[1]!)
    const AB = sub(b, a)
    if (dot(AO, AB) > 0) {
      set(direction, orth(AB, a))
    }
    else {
      set(direction, AO)
      simplex.shift()
    }
  }
  else {
    const a = simplex[2]!
    const b = simplex[1]!
    const c = simplex[0]!
    const AB = sub(b, a)
    const AC = sub(c, a)
    const AO = minus(a)
    const ACB = orth(AB, AC)
    const ABC = orth(AC, AB)

    if (dot(ACB, AO) > 0) {
      if (dot(AB, AO) > 0) {
        set(direction, ACB)
        simplex.shift()
      }
      else {
        set(direction, AO)
        simplex.splice(0, 2)
      }
    }
    else if (dot(ABC, AO) > 0) {
      if (dot(AC, AO) > 0) {
        set(direction, ABC)
        simplex.splice(1, 1)
      }
      else {
        set(direction, AO)
        simplex.splice(0, 2)
      }
    }
    else {
      return true
    }
  }
  return false
}

function minus(v: ReadonlyArray<number>): number[] {
  return [-v[0]!, -v[1]!]
}

function sub(v1: ReadonlyArray<number>, v2: ReadonlyArray<number>): number[] {
  return [v1[0]! - v2[0]!, v1[1]! - v2[1]!]
}

function dot(v1: ReadonlyArray<number>, v2: ReadonlyArray<number>): number {
  return v1[0]! * v2[0]! + v1[1]! * v2[1]!
}

function orth(v: ReadonlyArray<number>, from: ReadonlyArray<number>): number[] {
  const o = [-v[1]!, v[0]!]
  return dot(o, minus(from)) < 0 ? minus(o) : o
}

function gatherPoints(pathData: ReadonlyArray<PathDataItem>): Points {
  const points: Points = { list: [], minX: 0, minY: 0, maxX: 0, maxY: 0 }

  const addPoint = (path: PathPoint, point: number[]): void => {
    if (!path.list.length || point[1]! > path.list[path.maxY]![1]!) {
      path.maxY = path.list.length
      points.maxY = points.list.length ? Math.max(point[1]!, points.maxY) : point[1]!
    }
    if (!path.list.length || point[0]! > path.list[path.maxX]![0]!) {
      path.maxX = path.list.length
      points.maxX = points.list.length ? Math.max(point[0]!, points.maxX) : point[0]!
    }
    if (!path.list.length || point[1]! < path.list[path.minY]![1]!) {
      path.minY = path.list.length
      points.minY = points.list.length ? Math.min(point[1]!, points.minY) : point[1]!
    }
    if (!path.list.length || point[0]! < path.list[path.minX]![0]!) {
      path.minX = path.list.length
      points.minX = points.list.length ? Math.min(point[0]!, points.minX) : point[0]!
    }
    path.list.push(point)
  }

  for (let i = 0; i < pathData.length; i++) {
    const pathDataItem = pathData[i]!
    let subPath: PathPoint
      = points.list.length === 0
        ? { list: [], minX: 0, minY: 0, maxX: 0, maxY: 0 }
        : points.list[points.list.length - 1]!
    const prev = i === 0 ? null : pathData[i - 1]!
    let basePoint = subPath.list.length === 0 ? null : subPath.list[subPath.list.length - 1]!
    const data = pathDataItem.args
    let ctrlPoint = basePoint

    const toAbsolute = (n: number, idx: number): number => n + (basePoint == null ? 0 : basePoint[idx % 2]!)

    switch (pathDataItem.command) {
      case 'M':
        subPath = { list: [], minX: 0, minY: 0, maxX: 0, maxY: 0 }
        points.list.push(subPath)
        break
      case 'H':
        if (basePoint != null)
          addPoint(subPath, [data[0]!, basePoint[1]!])
        break
      case 'V':
        if (basePoint != null)
          addPoint(subPath, [basePoint[0]!, data[0]!])
        break
      case 'Q':
        addPoint(subPath, data.slice(0, 2))
        prevCtrlPoint = [data[2]! - data[0]!, data[3]! - data[1]!]
        break
      case 'T':
        if (basePoint != null && prev != null && (prev.command === 'Q' || prev.command === 'T')) {
          ctrlPoint = [basePoint[0]! + prevCtrlPoint[0], basePoint[1]! + prevCtrlPoint[1]]
          addPoint(subPath, ctrlPoint)
          prevCtrlPoint = [data[0]! - ctrlPoint[0]!, data[1]! - ctrlPoint[1]!]
        }
        break
      case 'C':
        if (basePoint != null) {
          addPoint(subPath, [
            0.5 * (basePoint[0]! + data[0]!),
            0.5 * (basePoint[1]! + data[1]!),
          ])
        }
        addPoint(subPath, [0.5 * (data[0]! + data[2]!), 0.5 * (data[1]! + data[3]!)])
        addPoint(subPath, [0.5 * (data[2]! + data[4]!), 0.5 * (data[3]! + data[5]!)])
        prevCtrlPoint = [data[4]! - data[2]!, data[5]! - data[3]!]
        break
      case 'S':
        if (basePoint != null && prev != null && (prev.command === 'C' || prev.command === 'S')) {
          addPoint(subPath, [
            basePoint[0]! + 0.5 * prevCtrlPoint[0],
            basePoint[1]! + 0.5 * prevCtrlPoint[1],
          ])
          ctrlPoint = [basePoint[0]! + prevCtrlPoint[0], basePoint[1]! + prevCtrlPoint[1]]
        }
        if (ctrlPoint != null)
          addPoint(subPath, [0.5 * (ctrlPoint[0]! + data[0]!), 0.5 * (ctrlPoint[1]! + data[1]!)])
        addPoint(subPath, [0.5 * (data[0]! + data[2]!), 0.5 * (data[1]! + data[3]!)])
        prevCtrlPoint = [data[2]! - data[0]!, data[3]! - data[1]!]
        break
      case 'A':
        if (basePoint != null) {
          const curves = a2c(basePoint[0]!, basePoint[1]!, data[0]!, data[1]!, data[2]!, data[3]!, data[4]!, data[5]!, data[6]!)
          let cData: number[]
          while ((cData = curves.splice(0, 6).map(toAbsolute)).length) {
            if (basePoint != null)
              addPoint(subPath, [0.5 * (basePoint[0]! + cData[0]!), 0.5 * (basePoint[1]! + cData[1]!)])
            addPoint(subPath, [0.5 * (cData[0]! + cData[2]!), 0.5 * (cData[1]! + cData[3]!)])
            addPoint(subPath, [0.5 * (cData[2]! + cData[4]!), 0.5 * (cData[3]! + cData[5]!)])
            if (curves.length)
              addPoint(subPath, basePoint = cData.slice(-2))
          }
        }
        break
    }

    if (data.length >= 2)
      addPoint(subPath, data.slice(-2))
  }
  return points
}

function convexHull(points: PathPoint): PathPoint {
  points.list.sort((a, b) => a[0] === b[0] ? a[1]! - b[1]! : a[0]! - b[0]!)

  const lower: number[][] = []
  let minY = 0
  let bottom = 0
  for (let i = 0; i < points.list.length; i++) {
    while (
      lower.length >= 2
      && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, points.list[i]!) <= 0
    ) {
      lower.pop()
    }
    if (points.list[i]![1]! < points.list[minY]![1]!) {
      minY = i
      bottom = lower.length
    }
    lower.push(points.list[i]!)
  }

  const upper: number[][] = []
  let maxY = points.list.length - 1
  let top = 0
  for (let i = points.list.length; i--;) {
    while (
      upper.length >= 2
      && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, points.list[i]!) <= 0
    ) {
      upper.pop()
    }
    if (points.list[i]![1]! > points.list[maxY]![1]!) {
      maxY = i
      top = upper.length
    }
    upper.push(points.list[i]!)
  }

  upper.pop()
  lower.pop()
  const hullList = lower.concat(upper)

  return {
    list: hullList,
    minX: 0,
    maxX: lower.length,
    minY: bottom,
    maxY: (lower.length + top) % hullList.length,
  }
}

function cross(o: ReadonlyArray<number>, a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  return (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!)
}

/**
 * Approximate an elliptical arc with a sequence of cubic Béziers.
 * Adapted from Snap.svg (Apache 2 license).
 */
function a2c(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  angle: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number,
  recursive?: ReadonlyArray<number>,
): number[] {
  const _120 = (Math.PI * 120) / 180
  const rad = (Math.PI / 180) * (+angle || 0)
  let res: number[] = []
  const rotateX = (x: number, y: number, r: number): number => x * Math.cos(r) - y * Math.sin(r)
  const rotateY = (x: number, y: number, r: number): number => x * Math.sin(r) + y * Math.cos(r)

  let cx: number, cy: number, f1: number, f2: number

  if (!recursive) {
    x1 = rotateX(x1, y1, -rad)
    y1 = rotateY(x1, y1, -rad)
    x2 = rotateX(x2, y2, -rad)
    y2 = rotateY(x2, y2, -rad)
    const x = (x1 - x2) / 2
    const y = (y1 - y2) / 2
    let h = (x * x) / (rx * rx) + (y * y) / (ry * ry)
    if (h > 1) {
      h = Math.sqrt(h)
      rx = h * rx
      ry = h * ry
    }
    const rx2 = rx * rx
    const ry2 = ry * ry
    const k
      = (largeArcFlag === sweepFlag ? -1 : 1)
      * Math.sqrt(Math.abs((rx2 * ry2 - rx2 * y * y - ry2 * x * x) / (rx2 * y * y + ry2 * x * x)))
    cx = (k * rx * y) / ry + (x1 + x2) / 2
    cy = (k * -ry * x) / rx + (y1 + y2) / 2
    f1 = Math.asin(Number(((y1 - cy) / ry).toFixed(9)))
    f2 = Math.asin(Number(((y2 - cy) / ry).toFixed(9)))
    f1 = x1 < cx ? Math.PI - f1 : f1
    f2 = x2 < cx ? Math.PI - f2 : f2
    if (f1 < 0)
      f1 = Math.PI * 2 + f1
    if (f2 < 0)
      f2 = Math.PI * 2 + f2
    if (sweepFlag && f1 > f2)
      f1 = f1 - Math.PI * 2
    if (!sweepFlag && f2 > f1)
      f2 = f2 - Math.PI * 2
  }
  else {
    f1 = recursive[0]!
    f2 = recursive[1]!
    cx = recursive[2]!
    cy = recursive[3]!
  }

  let df = f2 - f1
  if (Math.abs(df) > _120) {
    const f2old = f2
    const x2old = x2
    const y2old = y2
    f2 = f1 + _120 * (sweepFlag && f2 > f1 ? 1 : -1)
    x2 = cx + rx * Math.cos(f2)
    y2 = cy + ry * Math.sin(f2)
    res = a2c(x2, y2, rx, ry, angle, 0, sweepFlag, x2old, y2old, [f2, f2old, cx, cy])
  }
  df = f2 - f1
  const c1 = Math.cos(f1)
  const s1 = Math.sin(f1)
  const c2 = Math.cos(f2)
  const s2 = Math.sin(f2)
  const t = Math.tan(df / 4)
  const hx = (4 / 3) * rx * t
  const hy = (4 / 3) * ry * t
  const m = [
    -hx * s1,
    hy * c1,
    x2 + hx * s2 - x1,
    y2 - hy * c2 - y1,
    x2 - x1,
    y2 - y1,
  ]
  if (recursive)
    return m.concat(res)
  res = m.concat(res)
  const newres: number[] = []
  for (let i = 0; i < res.length; i++) {
    newres[i]
      = i % 2
        ? rotateY(res[i - 1]!, res[i]!, rad)
        : rotateX(res[i]!, res[i + 1]!, rad)
  }
  return newres
}
