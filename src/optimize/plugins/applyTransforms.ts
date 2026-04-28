/** Bake `transform="…"` into the actual path data (so transforms can be removed). (Adapted from SVGO, MIT.) */

import type { PathDataItem, Plugin } from '../types'
import { collectStylesheet, computeStyle } from '../style'
import { includesUrlReference, removeLeadingZero } from '../tools'
import { attrsGroupsDefaults, referencesProps } from './_collections'
import { path2js } from './_path'
import { transform2js, transformArc, transformsMultiply } from './_transforms'

export interface ApplyTransformsParams {
  transformPrecision: number
  applyTransformsStroked: boolean
}

const regNumericValues = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g

function transformAbsolutePoint(matrix: ReadonlyArray<number>, x: number, y: number): [number, number] {
  return [matrix[0]! * x + matrix[2]! * y + matrix[4]!, matrix[1]! * x + matrix[3]! * y + matrix[5]!]
}

function transformRelativePoint(matrix: ReadonlyArray<number>, x: number, y: number): [number, number] {
  return [matrix[0]! * x + matrix[2]! * y, matrix[1]! * x + matrix[3]! * y]
}

function applyMatrixToPathData(pathData: ReadonlyArray<PathDataItem>, matrix: ReadonlyArray<number>): void {
  const start: [number, number] = [0, 0]
  const cursor: [number, number] = [0, 0]

  for (const pathItem of pathData) {
    let { command, args } = pathItem

    if (command === 'M') {
      cursor[0] = args[0]!
      cursor[1] = args[1]!
      start[0] = cursor[0]
      start[1] = cursor[1]
      const [x, y] = transformAbsolutePoint(matrix, args[0]!, args[1]!)
      args[0] = x; args[1] = y
    }
    if (command === 'm') {
      cursor[0] += args[0]!
      cursor[1] += args[1]!
      start[0] = cursor[0]
      start[1] = cursor[1]
      const [x, y] = transformRelativePoint(matrix, args[0]!, args[1]!)
      args[0] = x; args[1] = y
    }

    if (command === 'H') {
      command = 'L'
      args = [args[0]!, cursor[1]]
    }
    if (command === 'h') {
      command = 'l'
      args = [args[0]!, 0]
    }
    if (command === 'V') {
      command = 'L'
      args = [cursor[0], args[0]!]
    }
    if (command === 'v') {
      command = 'l'
      args = [0, args[0]!]
    }

    if (command === 'L') {
      cursor[0] = args[0]!
      cursor[1] = args[1]!
      const [x, y] = transformAbsolutePoint(matrix, args[0]!, args[1]!)
      args[0] = x; args[1] = y
    }
    if (command === 'l') {
      cursor[0] += args[0]!
      cursor[1] += args[1]!
      const [x, y] = transformRelativePoint(matrix, args[0]!, args[1]!)
      args[0] = x; args[1] = y
    }

    if (command === 'C') {
      cursor[0] = args[4]!
      cursor[1] = args[5]!
      const [x1, y1] = transformAbsolutePoint(matrix, args[0]!, args[1]!)
      const [x2, y2] = transformAbsolutePoint(matrix, args[2]!, args[3]!)
      const [x, y] = transformAbsolutePoint(matrix, args[4]!, args[5]!)
      args[0] = x1; args[1] = y1; args[2] = x2; args[3] = y2; args[4] = x; args[5] = y
    }
    if (command === 'c') {
      cursor[0] += args[4]!
      cursor[1] += args[5]!
      const [x1, y1] = transformRelativePoint(matrix, args[0]!, args[1]!)
      const [x2, y2] = transformRelativePoint(matrix, args[2]!, args[3]!)
      const [x, y] = transformRelativePoint(matrix, args[4]!, args[5]!)
      args[0] = x1; args[1] = y1; args[2] = x2; args[3] = y2; args[4] = x; args[5] = y
    }

    if (command === 'S') {
      cursor[0] = args[2]!
      cursor[1] = args[3]!
      const [x2, y2] = transformAbsolutePoint(matrix, args[0]!, args[1]!)
      const [x, y] = transformAbsolutePoint(matrix, args[2]!, args[3]!)
      args[0] = x2; args[1] = y2; args[2] = x; args[3] = y
    }
    if (command === 's') {
      cursor[0] += args[2]!
      cursor[1] += args[3]!
      const [x2, y2] = transformRelativePoint(matrix, args[0]!, args[1]!)
      const [x, y] = transformRelativePoint(matrix, args[2]!, args[3]!)
      args[0] = x2; args[1] = y2; args[2] = x; args[3] = y
    }

    if (command === 'Q') {
      cursor[0] = args[2]!
      cursor[1] = args[3]!
      const [x1, y1] = transformAbsolutePoint(matrix, args[0]!, args[1]!)
      const [x, y] = transformAbsolutePoint(matrix, args[2]!, args[3]!)
      args[0] = x1; args[1] = y1; args[2] = x; args[3] = y
    }
    if (command === 'q') {
      cursor[0] += args[2]!
      cursor[1] += args[3]!
      const [x1, y1] = transformRelativePoint(matrix, args[0]!, args[1]!)
      const [x, y] = transformRelativePoint(matrix, args[2]!, args[3]!)
      args[0] = x1; args[1] = y1; args[2] = x; args[3] = y
    }

    if (command === 'T') {
      cursor[0] = args[0]!
      cursor[1] = args[1]!
      const [x, y] = transformAbsolutePoint(matrix, args[0]!, args[1]!)
      args[0] = x; args[1] = y
    }
    if (command === 't') {
      cursor[0] += args[0]!
      cursor[1] += args[1]!
      const [x, y] = transformRelativePoint(matrix, args[0]!, args[1]!)
      args[0] = x; args[1] = y
    }

    if (command === 'A') {
      transformArc(cursor, args, matrix)
      cursor[0] = args[5]!
      cursor[1] = args[6]!
      if (Math.abs(args[2]!) > 80) {
        const a = args[0]!
        const rotation = args[2]!
        args[0] = args[1]!
        args[1] = a
        args[2] = rotation + (rotation > 0 ? -90 : 90)
      }
      const [x, y] = transformAbsolutePoint(matrix, args[5]!, args[6]!)
      args[5] = x; args[6] = y
    }
    if (command === 'a') {
      transformArc([0, 0], args, matrix)
      cursor[0] += args[5]!
      cursor[1] += args[6]!
      if (Math.abs(args[2]!) > 80) {
        const a = args[0]!
        const rotation = args[2]!
        args[0] = args[1]!
        args[1] = a
        args[2] = rotation + (rotation > 0 ? -90 : 90)
      }
      const [x, y] = transformRelativePoint(matrix, args[5]!, args[6]!)
      args[5] = x; args[6] = y
    }

    if (command === 'z' || command === 'Z') {
      cursor[0] = start[0]
      cursor[1] = start[1]
    }

    pathItem.command = command
    pathItem.args = args
  }
}

export const applyTransforms: Plugin<ApplyTransformsParams> = (root, params) => {
  const stylesheet = collectStylesheet(root)
  return {
    element: {
      enter: (node) => {
        if (node.attributes.d == null)
          return
        if (node.attributes.id != null)
          return
        if (
          node.attributes.transform == null
          || node.attributes.transform === ''
          || node.attributes.style != null
          || Object.entries(node.attributes).some(
            ([n, v]) => referencesProps.has(n) && includesUrlReference(v),
          )
        ) {
          return
        }

        const computedStyle = computeStyle(stylesheet, node)
        const transformStyle = computedStyle.transform
        if (transformStyle && transformStyle.type === 'static' && transformStyle.value !== node.attributes.transform)
          return

        const matrix = transformsMultiply(transform2js(node.attributes.transform))

        const stroke = computedStyle.stroke?.type === 'static' ? computedStyle.stroke.value : null
        const strokeWidth = computedStyle['stroke-width']?.type === 'static' ? computedStyle['stroke-width'].value : null
        const transformPrecision = params.transformPrecision

        if (
          computedStyle.stroke?.type === 'dynamic'
          || computedStyle['stroke-width']?.type === 'dynamic'
        ) {
          return
        }

        const scale = Number(Math.hypot(matrix.data[0]!, matrix.data[1]!).toFixed(transformPrecision))

        if (stroke && stroke !== 'none') {
          if (!params.applyTransformsStroked)
            return
          if (
            (matrix.data[0] !== matrix.data[3] || matrix.data[1] !== -matrix.data[2]!)
            && (matrix.data[0] !== -matrix.data[3]! || matrix.data[1] !== matrix.data[2])
          ) {
            return
          }
          if (scale !== 1) {
            if (node.attributes['vector-effect'] !== 'non-scaling-stroke') {
              node.attributes['stroke-width'] = (strokeWidth || attrsGroupsDefaults.presentation!['stroke-width']!)
                .trim()
                .replace(regNumericValues, num => removeLeadingZero(Number(num) * scale))
              if (node.attributes['stroke-dashoffset'] != null) {
                node.attributes['stroke-dashoffset'] = node.attributes['stroke-dashoffset']
                  .trim()
                  .replace(regNumericValues, num => removeLeadingZero(Number(num) * scale))
              }
              if (node.attributes['stroke-dasharray'] != null) {
                node.attributes['stroke-dasharray'] = node.attributes['stroke-dasharray']
                  .trim()
                  .replace(regNumericValues, num => removeLeadingZero(Number(num) * scale))
              }
            }
          }
        }

        const pathData = path2js(node)
        applyMatrixToPathData(pathData, matrix.data)
        delete node.attributes.transform
      },
    },
  }
}
