/**
 * Heavy-weight `<path d="…">` optimiser.
 *
 *  - Converts absolute → relative coords (and back per-command if shorter).
 *  - Detects circular arcs hidden inside chains of cubic Béziers.
 *  - Drops zero-length / collinear segments, collapses repeats.
 *  - Lowers c→q where the quadratic approximation is exact.
 *  - Promotes lineto sequences to closepath when they return to subpath start.
 *  - Smart-rounds arc radii so chord/sagitta error stays within precision.
 *
 * Adapted from SVGO's plugins/convertPathData.js (MIT).
 */

import type { PathDataItem, Plugin } from '../types'
import { collectStylesheet, computeStyle } from '../style'
import { cleanupOutData, toFixed } from '../tools'
import { visit } from '../util/visit'
import { pathElems } from './_collections'
import { js2path, path2js } from './_path'
import { applyTransforms } from './applyTransforms'

interface MakeArcs {
  threshold: number
  tolerance: number
}

export interface ConvertPathDataParams {
  applyTransforms?: boolean
  applyTransformsStroked?: boolean
  makeArcs?: MakeArcs
  straightCurves?: boolean
  convertToQ?: boolean
  lineShorthands?: boolean
  convertToZ?: boolean
  curveSmoothShorthands?: boolean
  floatPrecision?: number | false
  transformPrecision?: number
  smartArcRounding?: boolean
  removeUseless?: boolean
  collapseRepeated?: boolean
  utilizeAbsolute?: boolean
  leadingZero?: boolean
  negativeExtraSpace?: boolean
  noSpaceAfterFlags?: boolean
  forceAbsolutePath?: boolean
}

type InternalParams = Required<ConvertPathDataParams>

type Point = [number, number]
interface Circle { center: Point, radius: number }

interface AnnotatedPathItem extends PathDataItem {
  base?: Point
  coords?: Point
  sdata?: number[]
}

export const name = 'convertPathData'
export const description = 'optimizes path data: writes in shorter form, applies transformations'

let roundData: (data: number[]) => number[]
let precision: number | false
let error: number
let arcThreshold: number
let arcTolerance: number

export const fn: Plugin<ConvertPathDataParams> = (root, params) => {
  const {
    applyTransforms: _applyTransforms = true,
    applyTransformsStroked = true,
    makeArcs = { threshold: 2.5, tolerance: 0.5 },
    straightCurves = true,
    convertToQ = true,
    lineShorthands = true,
    convertToZ = true,
    curveSmoothShorthands = true,
    floatPrecision = 3,
    transformPrecision = 5,
    smartArcRounding = true,
    removeUseless = true,
    collapseRepeated = true,
    utilizeAbsolute = true,
    leadingZero = true,
    negativeExtraSpace = true,
    noSpaceAfterFlags = false,
    forceAbsolutePath = false,
  } = params || {}

  const newParams: InternalParams = {
    applyTransforms: _applyTransforms,
    applyTransformsStroked,
    makeArcs,
    straightCurves,
    convertToQ,
    lineShorthands,
    convertToZ,
    curveSmoothShorthands,
    floatPrecision,
    transformPrecision,
    smartArcRounding,
    removeUseless,
    collapseRepeated,
    utilizeAbsolute,
    leadingZero,
    negativeExtraSpace,
    noSpaceAfterFlags,
    forceAbsolutePath,
  }

  if (_applyTransforms) {
    visit(root, applyTransforms(root, { transformPrecision, applyTransformsStroked }, { multipassCount: 0 })!)
  }

  const stylesheet = collectStylesheet(root)
  return {
    element: {
      enter: (node) => {
        if (pathElems.has(node.name) && node.attributes.d != null) {
          const computedStyle = computeStyle(stylesheet, node)
          precision = floatPrecision
          error = precision !== false
            ? +(0.1 ** precision).toFixed(precision)
            : 1e-2
          roundData = precision !== false && precision > 0 && precision < 20 ? strongRound : round
          if (makeArcs) {
            arcThreshold = makeArcs.threshold
            arcTolerance = makeArcs.tolerance
          }
          const hasMarkerMid = computedStyle['marker-mid'] != null

          const maybeHasStroke = computedStyle.stroke
            && (computedStyle.stroke.type === 'dynamic' || computedStyle.stroke.value !== 'none')
          const maybeHasLinecap = computedStyle['stroke-linecap']
            && (computedStyle['stroke-linecap'].type === 'dynamic' || computedStyle['stroke-linecap'].value !== 'butt')
          const isSafeToUseZ = maybeHasStroke
            ? computedStyle['stroke-linecap']?.type === 'static'
              && computedStyle['stroke-linecap'].value === 'round'
              && computedStyle['stroke-linejoin']?.type === 'static'
              && computedStyle['stroke-linejoin'].value === 'round'
            : true
          const isSafeToRemove = (isFirstDraw: boolean, safeIfNotFirstDraw: boolean): boolean => {
            if (!maybeHasStroke)
              return true
            if (isFirstDraw)
              return !maybeHasLinecap
            return safeIfNotFirstDraw
          }

          let data = path2js(node) as AnnotatedPathItem[]

          if (data.length) {
            const includesVertices = data.some(item => item.command !== 'm' && item.command !== 'M')
            convertToRelative(data)

            data = filters(data, newParams, { isSafeToUseZ, isSafeToRemove, hasMarkerMid })

            if (utilizeAbsolute)
              data = convertToMixed(data, newParams)

            const hasMarker
              = node.attributes['marker-start'] != null
              || node.attributes['marker-end'] != null
            const isMarkersOnlyPath = hasMarker
              && includesVertices
              && data.every(item => item.command === 'm' || item.command === 'M')

            if (isMarkersOnlyPath)
              data.push({ command: 'z', args: [] })

            js2path(node, data, {
              floatPrecision: typeof newParams.floatPrecision === 'number' ? newParams.floatPrecision : undefined,
              noSpaceAfterFlags: newParams.noSpaceAfterFlags,
            })
          }
        }
      },
    },
  }
}

function convertToRelative(pathData: AnnotatedPathItem[]): AnnotatedPathItem[] {
  const start: Point = [0, 0]
  const cursor: Point = [0, 0]
  let prevCoords: Point = [0, 0]

  for (let i = 0; i < pathData.length; i++) {
    const pathItem = pathData[i]!
    let { command, args } = pathItem

    if (command === 'm') {
      cursor[0] += args[0]!
      cursor[1] += args[1]!
      start[0] = cursor[0]
      start[1] = cursor[1]
    }
    else if (command === 'M') {
      if (i !== 0)
        command = 'm'
      args[0]! -= cursor[0]
      args[1]! -= cursor[1]
      cursor[0] += args[0]!
      cursor[1] += args[1]!
      start[0] = cursor[0]
      start[1] = cursor[1]
    }

    else if (command === 'l') {
      cursor[0] += args[0]!
      cursor[1] += args[1]!
    }
    else if (command === 'L') {
      command = 'l'
      args[0]! -= cursor[0]
      args[1]! -= cursor[1]
      cursor[0] += args[0]!
      cursor[1] += args[1]!
    }

    else if (command === 'h') {
      cursor[0] += args[0]!
    }
    else if (command === 'H') {
      command = 'h'
      args[0]! -= cursor[0]
      cursor[0] += args[0]!
    }

    else if (command === 'v') {
      cursor[1] += args[0]!
    }
    else if (command === 'V') {
      command = 'v'
      args[0]! -= cursor[1]
      cursor[1] += args[0]!
    }

    else if (command === 'c') {
      cursor[0] += args[4]!
      cursor[1] += args[5]!
    }
    else if (command === 'C') {
      command = 'c'
      args[0]! -= cursor[0]; args[1]! -= cursor[1]
      args[2]! -= cursor[0]; args[3]! -= cursor[1]
      args[4]! -= cursor[0]; args[5]! -= cursor[1]
      cursor[0] += args[4]!
      cursor[1] += args[5]!
    }

    else if (command === 's') {
      cursor[0] += args[2]!
      cursor[1] += args[3]!
    }
    else if (command === 'S') {
      command = 's'
      args[0]! -= cursor[0]; args[1]! -= cursor[1]
      args[2]! -= cursor[0]; args[3]! -= cursor[1]
      cursor[0] += args[2]!
      cursor[1] += args[3]!
    }

    else if (command === 'q') {
      cursor[0] += args[2]!
      cursor[1] += args[3]!
    }
    else if (command === 'Q') {
      command = 'q'
      args[0]! -= cursor[0]; args[1]! -= cursor[1]
      args[2]! -= cursor[0]; args[3]! -= cursor[1]
      cursor[0] += args[2]!
      cursor[1] += args[3]!
    }

    else if (command === 't') {
      cursor[0] += args[0]!
      cursor[1] += args[1]!
    }
    else if (command === 'T') {
      command = 't'
      args[0]! -= cursor[0]; args[1]! -= cursor[1]
      cursor[0] += args[0]!
      cursor[1] += args[1]!
    }

    else if (command === 'a') {
      cursor[0] += args[5]!
      cursor[1] += args[6]!
    }
    else if (command === 'A') {
      command = 'a'
      args[5]! -= cursor[0]; args[6]! -= cursor[1]
      cursor[0] += args[5]!
      cursor[1] += args[6]!
    }

    else if (command === 'Z' || command === 'z') {
      cursor[0] = start[0]
      cursor[1] = start[1]
    }

    pathItem.command = command
    pathItem.args = args
    pathItem.base = prevCoords
    pathItem.coords = [cursor[0], cursor[1]]
    prevCoords = pathItem.coords
  }
  return pathData
}

interface FilterMeta {
  isSafeToUseZ: boolean
  isSafeToRemove: (isFirstDraw: boolean, safeIfNotFirstDraw: boolean) => boolean
  hasMarkerMid: boolean
}

function filters(
  path: AnnotatedPathItem[],
  params: InternalParams,
  { isSafeToUseZ, isSafeToRemove, hasMarkerMid }: FilterMeta,
): AnnotatedPathItem[] {
  const stringify = data2Path.bind(null, params)
  const relSubpoint: Point = [0, 0]
  const pathBase: Point = [0, 0]
  let prev: AnnotatedPathItem = {} as AnnotatedPathItem
  let prevQControlPoint: Point | undefined

  path = path.filter(function (item, index, p) {
    const qControlPoint = prevQControlPoint
    let command = item.command
    let data = item.args
    let next: AnnotatedPathItem | undefined = p[index + 1]

    if (command !== 'Z' && command !== 'z') {
      let sdata = data
      let circle: Circle | undefined

      if (command === 's') {
        sdata = ([0, 0] as number[]).concat(data)
        const pdata = prev.args
        const n = pdata.length
        sdata[0] = pdata[n - 2]! - pdata[n - 4]!
        sdata[1] = pdata[n - 1]! - pdata[n - 3]!
      }

      if (
        params.makeArcs
        && (command === 'c' || command === 's')
        && isConvex(sdata)
        && (circle = findCircle(sdata))
      ) {
        const r = roundData([circle.radius])[0]!
        let angle = findArcAngle(sdata, circle)
        const sweep = sdata[5]! * sdata[0]! - sdata[4]! * sdata[1]! > 0 ? 1 : 0
        let arc: AnnotatedPathItem = {
          command: 'a',
          args: [r, r, 0, 0, sweep, sdata[4]!, sdata[5]!],
          coords: item.coords!.slice() as Point,
          base: item.base!,
        }
        const output: AnnotatedPathItem[] = [arc]
        const relCenter: Point = [circle.center[0] - sdata[4]!, circle.center[1] - sdata[5]!]
        const relCircle: Circle = { center: relCenter, radius: circle.radius }
        const arcCurves: AnnotatedPathItem[] = [item]
        let hasPrev = 0
        let suffix = ''
        let nextLonghand: AnnotatedPathItem | undefined

        if (
          (prev.command === 'c' && isConvex(prev.args) && isArcPrev(prev.args, circle))
          || (prev.command === 'a' && prev.sdata && isArcPrev(prev.sdata, circle))
        ) {
          arcCurves.unshift(prev)
          arc.base = prev.base!
          arc.args[5] = arc.coords![0] - arc.base[0]
          arc.args[6] = arc.coords![1] - arc.base[1]
          const prevData = prev.command === 'a' ? prev.sdata! : prev.args
          const prevAngle = findArcAngle(prevData, {
            center: [prevData[4]! + circle.center[0], prevData[5]! + circle.center[1]],
            radius: circle.radius,
          })
          angle += prevAngle
          if (angle > Math.PI)
            arc.args[3] = 1
          hasPrev = 1
        }

        for (let j = index; (next = p[++j]) && (next.command === 'c' || next.command === 's');) {
          let nextData = next.args
          if (next.command === 's') {
            nextLonghand = makeLonghand({ command: 's', args: next.args.slice() }, p[j - 1]!.args)
            nextData = nextLonghand.args
            nextLonghand.args = nextData.slice(0, 2)
            suffix = stringify([nextLonghand])
          }
          if (isConvex(nextData) && isArc(nextData, relCircle)) {
            angle += findArcAngle(nextData, relCircle)
            if (angle - 2 * Math.PI > 1e-3)
              break
            if (angle > Math.PI)
              arc.args[3] = 1
            arcCurves.push(next)
            if (2 * Math.PI - angle > 1e-3) {
              arc.coords = next.coords
              arc.args[5] = arc.coords![0] - arc.base![0]
              arc.args[6] = arc.coords![1] - arc.base![1]
            }
            else {
              arc.args[5] = 2 * (relCircle.center[0] - nextData[4]!)
              arc.args[6] = 2 * (relCircle.center[1] - nextData[5]!)
              arc.coords = [arc.base![0] + arc.args[5]!, arc.base![1] + arc.args[6]!]
              arc = {
                command: 'a',
                args: [r, r, 0, 0, sweep, next.coords![0] - arc.coords[0], next.coords![1] - arc.coords[1]],
                coords: next.coords,
                base: arc.coords,
              }
              output.push(arc)
              j++
              break
            }
            relCenter[0] -= nextData[4]!
            relCenter[1] -= nextData[5]!
          }
          else {
            break
          }
        }

        if ((stringify(output) + suffix).length < stringify(arcCurves).length) {
          if (p[next ? next.command === 's' ? path.indexOf(next) : -1 : -1])
            // legacy: noop
            void 0
          if (hasPrev) {
            const prevArc = output.shift()!
            roundData(prevArc.args)
            relSubpoint[0] += prevArc.args[5]! - prev.args[prev.args.length - 2]!
            relSubpoint[1] += prevArc.args[6]! - prev.args[prev.args.length - 1]!
            prev.command = 'a'
            prev.args = prevArc.args
            item.base = prev.coords = prevArc.coords
          }
          arc = output.shift()!
          if (arcCurves.length === 1) {
            item.sdata = sdata.slice()
          }
          else if (arcCurves.length - 1 - hasPrev > 0) {
            path.splice(index + 1, arcCurves.length - 1 - hasPrev, ...output)
          }
          if (!arc)
            return false
          command = 'a'
          data = arc.args
          item.coords = arc.coords
        }
      }

      if (precision !== false) {
        if (
          command === 'm' || command === 'l' || command === 't'
          || command === 'q' || command === 's' || command === 'c'
        ) {
          for (let i = data.length; i--;)
            data[i]! += item.base![i % 2]! - relSubpoint[i % 2]!
        }
        else if (command === 'h') {
          data[0]! += item.base![0] - relSubpoint[0]
        }
        else if (command === 'v') {
          data[0]! += item.base![1] - relSubpoint[1]
        }
        else if (command === 'a') {
          data[5]! += item.base![0] - relSubpoint[0]
          data[6]! += item.base![1] - relSubpoint[1]
        }
        roundData(data)

        if (command === 'h')
          relSubpoint[0] += data[0]!
        else if (command === 'v')
          relSubpoint[1] += data[0]!
        else {
          relSubpoint[0] += data[data.length - 2]!
          relSubpoint[1] += data[data.length - 1]!
        }
        roundData(relSubpoint)

        if (command === 'M' || command === 'm') {
          pathBase[0] = relSubpoint[0]
          pathBase[1] = relSubpoint[1]
        }
      }

      const sagitta = command === 'a' ? calculateSagitta(data) : undefined
      if (params.smartArcRounding && sagitta !== undefined && precision) {
        for (let precisionNew = precision; precisionNew >= 0; precisionNew--) {
          const radius = toFixed(data[0]!, precisionNew)
          const sagittaNew = calculateSagitta([radius, radius, ...data.slice(2)])!
          if (Math.abs(sagitta - sagittaNew) < error) {
            data[0] = radius
            data[1] = radius
          }
          else {
            break
          }
        }
      }

      if (params.straightCurves) {
        if (
          (command === 'c' && isCurveStraightLine(data))
          || (command === 's' && isCurveStraightLine(sdata))
        ) {
          if (next && next.command === 's')
            makeLonghand(next, data)
          command = 'l'
          data = data.slice(-2)
        }
        else if (
          (command === 'q' && isCurveStraightLine(data))
          || (command === 't' && prev.command !== 'q' && prev.command !== 't')
        ) {
          if (command === 'q' && next && next.command === 't')
            makeLonghand(next, data)
          if (command === 't' && next && next.command === 't') {
            next.command = 'q'
            next.args.unshift(
              (2 * item.coords![0] - item.base![0]) - item.coords![0],
              (2 * item.coords![1] - item.base![1]) - item.coords![1],
            )
          }
          command = 'l'
          data = data.slice(-2)
        }
        else if (
          command === 'a'
          && (data[0] === 0 || data[1] === 0 || (sagitta !== undefined && sagitta < error))
        ) {
          command = 'l'
          data = data.slice(-2)
        }
      }

      if (params.convertToQ && command === 'c') {
        const x1 = 0.75 * (item.base![0] + data[0]!) - 0.25 * item.base![0]
        const x2 = 0.75 * (item.base![0] + data[2]!) - 0.25 * (item.base![0] + data[4]!)
        if (Math.abs(x1 - x2) < error * 2) {
          const y1 = 0.75 * (item.base![1] + data[1]!) - 0.25 * item.base![1]
          const y2 = 0.75 * (item.base![1] + data[3]!) - 0.25 * (item.base![1] + data[5]!)
          if (Math.abs(y1 - y2) < error * 2) {
            const newData = data.slice()
            newData.splice(0, 4, x1 + x2 - item.base![0], y1 + y2 - item.base![1])
            roundData(newData)
            const originalLength = cleanupOutData(data, params).length
            const newLength = cleanupOutData(newData, params).length
            if (newLength < originalLength) {
              command = 'q'
              data = newData
              if (next && next.command === 's')
                makeLonghand(next, data)
            }
          }
        }
      }

      if (params.lineShorthands && command === 'l') {
        if (data[1] === 0) {
          command = 'h'
          data.pop()
        }
        else if (data[0] === 0) {
          command = 'v'
          data.shift()
        }
      }

      if (
        params.collapseRepeated
        && !hasMarkerMid
        && (command === 'm' || command === 'h' || command === 'v')
        && prev.command
        && command === prev.command.toLowerCase()
        && ((command !== 'h' && command !== 'v') || (prev.args[0]! >= 0) === (data[0]! >= 0))
      ) {
        prev.args[0]! += data[0]!
        if (command !== 'h' && command !== 'v')
          prev.args[1]! += data[1]!
        prev.coords = item.coords
        path[index] = prev
        return false
      }

      if (params.curveSmoothShorthands && prev.command) {
        if (command === 'c') {
          if (
            prev.command === 'c'
            && Math.abs(data[0]! - -(prev.args[2]! - prev.args[4]!)) < error
            && Math.abs(data[1]! - -(prev.args[3]! - prev.args[5]!)) < error
          ) {
            command = 's'
            data = data.slice(2)
          }
          else if (
            prev.command === 's'
            && Math.abs(data[0]! - -(prev.args[0]! - prev.args[2]!)) < error
            && Math.abs(data[1]! - -(prev.args[1]! - prev.args[3]!)) < error
          ) {
            command = 's'
            data = data.slice(2)
          }
          else if (
            prev.command !== 'c'
            && prev.command !== 's'
            && Math.abs(data[0]!) < error
            && Math.abs(data[1]!) < error
          ) {
            command = 's'
            data = data.slice(2)
          }
        }
        else if (command === 'q') {
          if (
            prev.command === 'q'
            && Math.abs(data[0]! - (prev.args[2]! - prev.args[0]!)) < error
            && Math.abs(data[1]! - (prev.args[3]! - prev.args[1]!)) < error
          ) {
            command = 't'
            data = data.slice(2)
          }
          else if (prev.command === 't') {
            const predicted = reflectPoint(qControlPoint!, item.base!)
            const real: Point = [data[0]! + item.base![0], data[1]! + item.base![1]]
            if (
              Math.abs(predicted[0] - real[0]) < error
              && Math.abs(predicted[1] - real[1]) < error
            ) {
              command = 't'
              data = data.slice(2)
            }
          }
        }
      }

      if (
        params.removeUseless
        && isSafeToRemove(prev.command === 'm' || prev.command === 'M', true)
      ) {
        if (
          (command === 'l' || command === 'h' || command === 'v'
            || command === 'q' || command === 't' || command === 'c' || command === 's')
          && data.every(i => i === 0)
        ) {
          path[index] = prev
          return false
        }
        if (command === 'a' && data[5] === 0 && data[6] === 0) {
          path[index] = prev
          return false
        }
      }

      if (
        params.convertToZ
        && (isSafeToUseZ || next?.command === 'Z' || next?.command === 'z')
        && (command === 'l' || command === 'h' || command === 'v')
      ) {
        if (
          Math.abs(pathBase[0] - item.coords![0]) < error
          && Math.abs(pathBase[1] - item.coords![1]) < error
        ) {
          command = 'z'
          data = []
        }
      }

      item.command = command
      item.args = data
    }
    else {
      relSubpoint[0] = pathBase[0]
      relSubpoint[1] = pathBase[1]
      if (prev.command === 'Z' || prev.command === 'z')
        return false
    }
    if (
      (command === 'Z' || command === 'z')
      && params.removeUseless
      && isSafeToRemove(prev.command === 'm' || prev.command === 'M', isSafeToUseZ)
      && Math.abs(item.base![0] - item.coords![0]) < error / 10
      && Math.abs(item.base![1] - item.coords![1]) < error / 10
    ) {
      return false
    }

    if (command === 'q') {
      prevQControlPoint = [data[0]! + item.base![0], data[1]! + item.base![1]]
    }
    else if (command === 't') {
      if (qControlPoint)
        prevQControlPoint = reflectPoint(qControlPoint, item.base!)
      else
        prevQControlPoint = item.coords
    }
    else {
      prevQControlPoint = undefined
    }
    prev = item
    return true
  })
  return path
}

function convertToMixed(path: AnnotatedPathItem[], params: InternalParams): AnnotatedPathItem[] {
  let prev = path[0]!

  path = path.filter(function (item, index) {
    if (index === 0)
      return true
    if (item.command === 'Z' || item.command === 'z') {
      prev = item
      return true
    }
    const command = item.command
    const data = item.args
    const adata = data.slice()
    const rdata = data.slice()

    if (
      command === 'm' || command === 'l' || command === 't'
      || command === 'q' || command === 's' || command === 'c'
    ) {
      for (let i = adata.length; i--;)
        adata[i]! += item.base![i % 2]!
    }
    else if (command === 'h') {
      adata[0]! += item.base![0]
    }
    else if (command === 'v') {
      adata[0]! += item.base![1]
    }
    else if (command === 'a') {
      adata[5]! += item.base![0]
      adata[6]! += item.base![1]
    }

    roundData(adata)
    roundData(rdata)

    const absoluteDataStr = cleanupOutData(adata, params)
    const relativeDataStr = cleanupOutData(rdata, params)

    if (
      params.forceAbsolutePath
      || (absoluteDataStr.length < relativeDataStr.length
        && !(
          params.negativeExtraSpace
          && command === prev.command
          && prev.command.charCodeAt(0) > 96
          && absoluteDataStr.length === relativeDataStr.length - 1
          && (data[0]! < 0
            || (Math.floor(data[0]!) === 0
              && !Number.isInteger(data[0]!)
              && (prev.args[prev.args.length - 1]! % 1)))
        ))
    ) {
      item.command = command.toUpperCase() as PathDataItem['command']
      item.args = adata
    }
    prev = item
    return true
  })
  return path
}

function isConvex(data: ReadonlyArray<number>): boolean {
  const center = getIntersection([
    0, 0,
    data[2]!, data[3]!,
    data[0]!, data[1]!,
    data[4]!, data[5]!,
  ])
  return (
    center != null
    && (data[2]! < center[0]) === (center[0] < 0)
    && (data[3]! < center[1]) === (center[1] < 0)
    && (data[4]! < center[0]) === (center[0] < data[0]!)
    && (data[5]! < center[1]) === (center[1] < data[1]!)
  )
}

function getIntersection(coords: ReadonlyArray<number>): Point | undefined {
  const a1 = coords[1]! - coords[3]!
  const b1 = coords[2]! - coords[0]!
  const c1 = coords[0]! * coords[3]! - coords[2]! * coords[1]!
  const a2 = coords[5]! - coords[7]!
  const b2 = coords[6]! - coords[4]!
  const c2 = coords[4]! * coords[7]! - coords[5]! * coords[6]!
  const denom = a1 * b2 - a2 * b1
  if (!denom)
    return
  const cross: Point = [(b1 * c2 - b2 * c1) / denom, (a1 * c2 - a2 * c1) / -denom]
  if (!Number.isNaN(cross[0]) && !Number.isNaN(cross[1]) && Number.isFinite(cross[0]) && Number.isFinite(cross[1]))
    return cross
}

function strongRound(data: number[]): number[] {
  const precisionNum = (precision as number) || 0
  for (let i = data.length; i-- > 0;) {
    const fixed = toFixed(data[i]!, precisionNum)
    if (fixed !== data[i]) {
      const rounded = toFixed(data[i]!, precisionNum - 1)
      data[i] = toFixed(Math.abs(rounded - data[i]!), precisionNum + 1) >= error
        ? fixed
        : rounded
    }
  }
  return data
}

function round(data: number[]): number[] {
  for (let i = data.length; i-- > 0;)
    data[i] = Math.round(data[i]!)
  return data
}

function isCurveStraightLine(data: ReadonlyArray<number>): boolean {
  let i = data.length - 2
  const a = -data[i + 1]!
  const b = data[i]!
  const d = 1 / (a * a + b * b)
  if (i <= 1 || !Number.isFinite(d))
    return false
  while ((i -= 2) >= 0) {
    if (Math.sqrt((a * data[i]! + b * data[i + 1]!) ** 2 * d) > error)
      return false
  }
  return true
}

function calculateSagitta(data: ReadonlyArray<number>): number | undefined {
  if (data[3] === 1)
    return undefined
  const rx = data[0]!
  const ry = data[1]!
  if (Math.abs(rx - ry) > error)
    return undefined
  const chord = Math.hypot(data[5]!, data[6]!)
  if (chord > rx * 2)
    return undefined
  return rx - Math.sqrt(rx ** 2 - 0.25 * chord ** 2)
}

function makeLonghand(item: PathDataItem, data: ReadonlyArray<number>): PathDataItem {
  switch (item.command) {
    case 's': item.command = 'c'; break
    case 't': item.command = 'q'; break
  }
  item.args.unshift(
    data[data.length - 2]! - data[data.length - 4]!,
    data[data.length - 1]! - data[data.length - 3]!,
  )
  return item
}

function getDistance(p1: Point, p2: Point): number {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1])
}

function reflectPoint(controlPoint: Point, base: Point): Point {
  return [2 * base[0] - controlPoint[0], 2 * base[1] - controlPoint[1]]
}

function getCubicBezierPoint(curve: ReadonlyArray<number>, t: number): Point {
  const sqrT = t * t
  const cubT = sqrT * t
  const mt = 1 - t
  const sqrMt = mt * mt
  return [
    3 * sqrMt * t * curve[0]! + 3 * mt * sqrT * curve[2]! + cubT * curve[4]!,
    3 * sqrMt * t * curve[1]! + 3 * mt * sqrT * curve[3]! + cubT * curve[5]!,
  ]
}

function findCircle(curve: ReadonlyArray<number>): Circle | undefined {
  const midPoint = getCubicBezierPoint(curve, 1 / 2)
  const m1: Point = [midPoint[0] / 2, midPoint[1] / 2]
  const m2: Point = [(midPoint[0] + curve[4]!) / 2, (midPoint[1] + curve[5]!) / 2]
  const center = getIntersection([
    m1[0], m1[1],
    m1[0] + m1[1], m1[1] - m1[0],
    m2[0], m2[1],
    m2[0] + (m2[1] - midPoint[1]),
    m2[1] - (m2[0] - midPoint[0]),
  ])
  const radius = center && getDistance([0, 0], center)
  const tolerance = Math.min(arcThreshold * error, ((arcTolerance * (radius || 0)) / 100))

  if (
    center
    && radius! < 1e15
    && [1 / 4, 3 / 4].every(point =>
      Math.abs(getDistance(getCubicBezierPoint(curve, point), center) - radius!) <= tolerance,
    )
  ) {
    return { center, radius: radius! }
  }
}

function isArc(curve: ReadonlyArray<number>, circle: Circle): boolean {
  const tolerance = Math.min(arcThreshold * error, (arcTolerance * circle.radius) / 100)
  return [0, 1 / 4, 1 / 2, 3 / 4, 1].every(point =>
    Math.abs(getDistance(getCubicBezierPoint(curve, point), circle.center) - circle.radius) <= tolerance,
  )
}

function isArcPrev(curve: ReadonlyArray<number>, circle: Circle): boolean {
  return isArc(curve, {
    center: [circle.center[0] + curve[4]!, circle.center[1] + curve[5]!],
    radius: circle.radius,
  })
}

function findArcAngle(curve: ReadonlyArray<number>, relCircle: Circle): number {
  const x1 = -relCircle.center[0]
  const y1 = -relCircle.center[1]
  const x2 = curve[4]! - relCircle.center[0]
  const y2 = curve[5]! - relCircle.center[1]
  return Math.acos((x1 * x2 + y1 * y2) / Math.sqrt((x1 * x1 + y1 * y1) * (x2 * x2 + y2 * y2)))
}

function data2Path(params: InternalParams, pathData: ReadonlyArray<PathDataItem>): string {
  return pathData.reduce((pathString, item) => {
    let strData = ''
    if (item.args)
      strData = cleanupOutData(roundData(item.args.slice()), params)
    return pathString + item.command + strData
  }, '')
}
