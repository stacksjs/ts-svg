/** Trim attribute values, collapse runs of whitespace, and convert newlines. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export interface CleanupAttrsParams {
  newlines?: boolean
  trim?: boolean
  spaces?: boolean
}

export const name = 'cleanupAttrs'
export const description = 'cleanups attributes from newlines, trailing and repeating spaces'

const regNewlinesNeedSpace = /(\S)\r?\n(\S)/g
const regNewlines = /\r?\n/g
const regSpaces = /\s{2,}/g

export const fn: Plugin<CleanupAttrsParams> = (_root, params) => {
  const { newlines = true, trim = true, spaces = true } = params || {}
  return {
    element: {
      enter: (node) => {
        for (const n of Object.keys(node.attributes)) {
          if (newlines) {
            node.attributes[n] = node.attributes[n]!.replace(regNewlinesNeedSpace, (_m, p1, p2) => `${p1} ${p2}`)
            node.attributes[n] = node.attributes[n]!.replace(regNewlines, '')
          }
          if (trim)
            node.attributes[n] = node.attributes[n]!.trim()
          if (spaces)
            node.attributes[n] = node.attributes[n]!.replace(regSpaces, ' ')
        }
      },
    },
  }
}
