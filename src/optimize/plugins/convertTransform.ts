/** Collapse `transform="…"` chains, normalise to short forms, and drop identity transforms. (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement } from '../types'
import type { TransformItem, TransformParams } from './_transforms'
import {
  js2transform,
  matrixToTransform,
  roundTransform,
  transform2js,
  transformsMultiply,
} from './_transforms'

export interface ConvertTransformParams {
  convertToShorts?: boolean
  degPrecision?: number
  floatPrecision?: number
  transformPrecision?: number
  matrixToTransform?: boolean
  shortTranslate?: boolean
  shortScale?: boolean
  shortRotate?: boolean
  removeUseless?: boolean
  collapseIntoOne?: boolean
  leadingZero?: boolean
  negativeExtraSpace?: boolean
}

export const name = 'convertTransform'
export const description = 'collapses multiple transformations and optimizes it'

export const fn: Plugin<ConvertTransformParams> = (_root, params) => {
  const {
    convertToShorts = true,
    degPrecision,
    floatPrecision = 3,
    transformPrecision = 5,
    matrixToTransform: matrixToTransformOpt = true,
    shortTranslate = true,
    shortScale = true,
    shortRotate = true,
    removeUseless = true,
    collapseIntoOne = true,
    leadingZero = true,
    negativeExtraSpace = false,
  } = params || {}
  const newParams: TransformParams = {
    convertToShorts,
    degPrecision,
    floatPrecision,
    transformPrecision,
    matrixToTransform: matrixToTransformOpt,
    shortTranslate,
    shortScale,
    shortRotate,
    removeUseless,
    collapseIntoOne,
    leadingZero,
    negativeExtraSpace,
  }
  return {
    element: {
      enter: (node) => {
        if (node.attributes.transform != null)
          convertTransform(node, 'transform', newParams)
        if (node.attributes.gradientTransform != null)
          convertTransform(node, 'gradientTransform', newParams)
        if (node.attributes.patternTransform != null)
          convertTransform(node, 'patternTransform', newParams)
      },
    },
  }
}

function convertTransform(item: XastElement, attrName: string, params: TransformParams): void {
  let data = transform2js(item.attributes[attrName]!)
  params = definePrecision(data, params)

  if (params.collapseIntoOne && data.length > 1)
    data = [transformsMultiply(data)]

  if (params.convertToShorts)
    data = convertToShorts(data, params)
  else
    data.forEach(t => roundTransform(t, params))

  if (params.removeUseless)
    data = removeUseless(data)

  if (data.length)
    item.attributes[attrName] = js2transform(data, params)
  else
    delete item.attributes[attrName]
}

function definePrecision(data: ReadonlyArray<TransformItem>, params: TransformParams): TransformParams {
  const newParams = { ...params }
  const matrixData: number[] = []
  for (const item of data) {
    if (item.name === 'matrix')
      matrixData.push(...item.data.slice(0, 4))
  }
  let numberOfDigits = newParams.transformPrecision
  if (matrixData.length) {
    newParams.transformPrecision = Math.min(
      newParams.transformPrecision,
      Math.max(...matrixData.map(floatDigits)) || newParams.transformPrecision,
    )
    numberOfDigits = Math.max(...matrixData.map(n => n.toString().replace(/\D+/g, '').length))
  }
  if (newParams.degPrecision == null)
    newParams.degPrecision = Math.max(0, Math.min(newParams.floatPrecision, numberOfDigits - 2))
  return newParams
}

function floatDigits(n: number): number {
  const str = n.toString()
  return str.slice(str.indexOf('.')).length - 1
}

function convertToShorts(transforms: TransformItem[], params: TransformParams): TransformItem[] {
  for (let i = 0; i < transforms.length; i++) {
    let transform = transforms[i]!
    if (params.matrixToTransform && transform.name === 'matrix') {
      const decomposed = matrixToTransform(transform, params)
      if (
        js2transform(decomposed, params).length
        <= js2transform([transform], params).length
      ) {
        transforms.splice(i, 1, ...decomposed)
      }
      transform = transforms[i]!
    }
    roundTransform(transform, params)

    if (
      params.shortTranslate
      && transform.name === 'translate'
      && transform.data.length === 2
      && !transform.data[1]
    ) {
      transform.data.pop()
    }

    if (
      params.shortScale
      && transform.name === 'scale'
      && transform.data.length === 2
      && transform.data[0] === transform.data[1]
    ) {
      transform.data.pop()
    }

    if (
      params.shortRotate
      && transforms[i - 2]?.name === 'translate'
      && transforms[i - 1]?.name === 'rotate'
      && transforms[i]?.name === 'translate'
      && transforms[i - 2]!.data[0] === -transforms[i]!.data[0]!
      && transforms[i - 2]!.data[1] === -transforms[i]!.data[1]!
    ) {
      transforms.splice(i - 2, 3, {
        name: 'rotate',
        data: [
          transforms[i - 1]!.data[0]!,
          transforms[i - 2]!.data[0]!,
          transforms[i - 2]!.data[1]!,
        ],
      })
      i -= 2
    }
  }
  return transforms
}

function removeUseless(transforms: ReadonlyArray<TransformItem>): TransformItem[] {
  return transforms.filter((t) => {
    if (
      (['translate', 'rotate', 'skewX', 'skewY'].includes(t.name)
        && (t.data.length === 1 || t.name === 'rotate')
        && !t.data[0])
      || (t.name === 'translate' && !t.data[0] && !t.data[1])
      || (t.name === 'scale' && t.data[0] === 1 && (t.data.length < 2 || t.data[1] === 1))
      || (t.name === 'matrix'
        && t.data[0] === 1
        && t.data[3] === 1
        && !(t.data[1] || t.data[2] || t.data[4] || t.data[5]))
    ) {
      return false
    }
    return true
  })
}
