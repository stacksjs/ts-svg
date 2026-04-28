/** Normalise color values: rgb()/named/long-hex → short-hex / shortname / currentColor. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { includesCssVarReference, includesUrlReference } from '../tools'
import { colorsNames, colorsProps, colorsShortNames } from './_collections'

export interface ConvertColorsParams {
  currentColor?: boolean | string | RegExp
  names2hex?: boolean
  rgb2hex?: boolean
  convertCase?: false | 'lower' | 'upper'
  shorthex?: boolean
  shortname?: boolean
}

export const name = 'convertColors'
export const description = 'converts colors: rgb() to #rrggbb and #rrggbb to #rgb'

const rNumber = '([+-]?(?:\\d*\\.\\d+|\\d+\\.?)%?)'
const rComma = '(?:\\s*,\\s*|\\s+)'
const regRGB = new RegExp(`^rgb\\(\\s*${rNumber}${rComma}${rNumber}${rComma}${rNumber}\\s*\\)$`)
const regHEX = /^#(([a-f0-9])\2){3}$/i

function convertRgbToHex([r, g, b]: ReadonlyArray<number>): string {
  const hexNumber = ((((256 + r!) << 8) | g!) << 8) | b!
  return `#${hexNumber.toString(16).slice(1).toUpperCase()}`
}

export const fn: Plugin<ConvertColorsParams> = (_root, params) => {
  const {
    currentColor = false,
    names2hex = true,
    rgb2hex = true,
    convertCase = 'lower',
    shorthex = true,
    shortname = true,
  } = params || {}

  let maskCounter = 0

  return {
    element: {
      enter: (node) => {
        if (node.name === 'mask')
          maskCounter++
        for (const [n, value] of Object.entries(node.attributes)) {
          if (colorsProps.has(n)) {
            let val = value
            if (currentColor && maskCounter === 0) {
              let matched: boolean
              if (typeof currentColor === 'string')
                matched = val === currentColor
              else if (currentColor instanceof RegExp)
                matched = currentColor.exec(val) != null
              else
                matched = val !== 'none'
              if (matched)
                val = 'currentColor'
            }
            if (names2hex) {
              const colorName = val.toLowerCase()
              if (colorsNames[colorName] != null)
                val = colorsNames[colorName]!
            }
            if (rgb2hex) {
              const match = val.match(regRGB)
              if (match != null) {
                const numbers = match.slice(1, 4).map((m) => {
                  let nn: number
                  if (m.includes('%'))
                    nn = Math.round(Number.parseFloat(m) * 2.55)
                  else
                    nn = Number(m)
                  return Math.max(0, Math.min(nn, 255))
                })
                val = convertRgbToHex(numbers)
              }
            }
            if (
              convertCase
              && !includesUrlReference(val)
              && !includesCssVarReference(val)
              && val !== 'currentColor'
            ) {
              if (convertCase === 'lower')
                val = val.toLowerCase()
              else if (convertCase === 'upper')
                val = val.toUpperCase()
            }
            if (shorthex) {
              const match = regHEX.exec(val)
              if (match != null)
                val = `#${match[0][1]}${match[0][3]}${match[0][5]}`
            }
            if (shortname) {
              const colorName = val.toLowerCase()
              if (colorsShortNames[colorName] != null)
                val = colorsShortNames[colorName]!
            }
            node.attributes[n] = val
          }
        }
      },
      exit: (node) => {
        if (node.name === 'mask')
          maskCounter--
      },
    },
  }
}
