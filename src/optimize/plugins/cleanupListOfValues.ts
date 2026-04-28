/** Round numeric lists (points/viewBox/dasharray/etc.) to a fixed precision. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { removeLeadingZero } from '../tools'

export interface CleanupListOfValuesParams {
  floatPrecision?: number
  leadingZero?: boolean
  defaultPx?: boolean
  convertToPx?: boolean
}

export const name = 'cleanupListOfValues'
export const description = 'rounds list of values to the fixed precision'

const regNumericValues = /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(px|pt|pc|mm|cm|m|in|ft|em|ex|%)?$/
const regSeparator = /\s+,?\s*|,\s*/
const absoluteLengths: Record<string, number> = {
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  in: 96,
  pt: 4 / 3,
  pc: 16,
  px: 1,
}

export const fn: Plugin<CleanupListOfValuesParams> = (_root, params) => {
  const {
    floatPrecision = 3,
    leadingZero = true,
    defaultPx = true,
    convertToPx = true,
  } = params || {}

  const roundValues = (lists: string): string => {
    const out: string[] = []
    for (const elem of lists.split(regSeparator)) {
      const match = elem.match(regNumericValues)
      const matchNew = elem.match(/new/)
      if (match) {
        let num = Number(Number(match[1]).toFixed(floatPrecision))
        const matchedUnit = match[2] || ''
        let units = matchedUnit
        if (convertToPx && units && units in absoluteLengths) {
          const pxNum = Number((absoluteLengths[units]! * Number(match[1])).toFixed(floatPrecision))
          if (pxNum.toString().length < match[0].length) {
            num = pxNum
            units = 'px'
          }
        }
        let str: string
        if (leadingZero)
          str = removeLeadingZero(num)
        else
          str = num.toString()
        if (defaultPx && units === 'px')
          units = ''
        out.push(str + units)
      }
      else if (matchNew) {
        out.push('new')
      }
      else if (elem) {
        out.push(elem)
      }
    }
    return out.join(' ')
  }

  return {
    element: {
      enter: (node) => {
        if (node.attributes.points != null)
          node.attributes.points = roundValues(node.attributes.points)
        if (node.attributes['enable-background'] != null)
          node.attributes['enable-background'] = roundValues(node.attributes['enable-background'])
        if (node.attributes.viewBox != null)
          node.attributes.viewBox = roundValues(node.attributes.viewBox)
        if (node.attributes['stroke-dasharray'] != null)
          node.attributes['stroke-dasharray'] = roundValues(node.attributes['stroke-dasharray'])
        if (node.attributes.dx != null)
          node.attributes.dx = roundValues(node.attributes.dx)
        if (node.attributes.dy != null)
          node.attributes.dy = roundValues(node.attributes.dy)
        if (node.attributes.x != null)
          node.attributes.x = roundValues(node.attributes.x)
        if (node.attributes.y != null)
          node.attributes.y = roundValues(node.attributes.y)
      },
    },
  }
}
