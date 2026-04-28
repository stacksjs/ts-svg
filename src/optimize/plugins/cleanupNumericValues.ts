/** Round numeric values to fixed precision, drop default `px` units, normalise lengths. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { removeLeadingZero } from '../tools'

export interface CleanupNumericValuesParams {
  floatPrecision?: number
  leadingZero?: boolean
  defaultPx?: boolean
  convertToPx?: boolean
}

export const name = 'cleanupNumericValues'
export const description = 'rounds numeric values to the fixed precision, removes default "px" units'

const regNumericValues = /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(px|pt|pc|mm|cm|m|in|ft|em|ex|%)?$/

const absoluteLengths: Record<string, number> = {
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  in: 96,
  pt: 4 / 3,
  pc: 16,
  px: 1,
}

export const fn: Plugin<CleanupNumericValuesParams> = (_root, params) => {
  const {
    floatPrecision = 3,
    leadingZero = true,
    defaultPx = true,
    convertToPx = true,
  } = params || {}

  return {
    element: {
      enter: (node) => {
        if (node.attributes.viewBox != null) {
          const numbers = node.attributes.viewBox.trim().split(/(?:\s,?|,)\s*/g)
          node.attributes.viewBox = numbers
            .map((value) => {
              const num = Number(value)
              return Number.isNaN(num) ? value : Number(num.toFixed(floatPrecision))
            })
            .join(' ')
        }

        for (const [n, value] of Object.entries(node.attributes)) {
          if (n === 'version')
            continue
          const match = regNumericValues.exec(value)
          if (match) {
            let num = Number(Number(match[1]).toFixed(floatPrecision))
            const matchedUnit = match[2] || ''
            let units = matchedUnit

            if (convertToPx && units !== '' && units in absoluteLengths) {
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

            node.attributes[n] = str + units
          }
        }
      },
    },
  }
}
