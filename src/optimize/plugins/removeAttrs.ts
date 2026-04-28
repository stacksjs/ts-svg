/** Pattern-based attribute removal: `element:attribute:value`. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export interface RemoveAttrsParams {
  elemSeparator?: string
  preserveCurrentColor?: boolean
  attrs: string | string[]
}

export const name = 'removeAttrs'
export const description = 'removes specified attributes'

const DEFAULT_SEPARATOR = ':'
const ENOATTRS = `Warning: The plugin "removeAttrs" requires the "attrs" parameter.
It should have a pattern to remove, otherwise the plugin is a noop.`

export const fn: Plugin<RemoveAttrsParams> = (_root, params) => {
  if (!params || typeof params.attrs === 'undefined') {
    console.warn(ENOATTRS)
    return null
  }
  const elemSeparator = typeof params.elemSeparator === 'string' ? params.elemSeparator : DEFAULT_SEPARATOR
  const preserveCurrentColor = typeof params.preserveCurrentColor === 'boolean' ? params.preserveCurrentColor : false
  const attrs = Array.isArray(params.attrs) ? params.attrs : [params.attrs]

  return {
    element: {
      enter: (node) => {
        for (let pattern of attrs) {
          if (!pattern.includes(elemSeparator))
            pattern = ['.*', pattern, '.*'].join(elemSeparator)
          else if (pattern.split(elemSeparator).length < 3)
            pattern = [pattern, '.*'].join(elemSeparator)

          const list = pattern.split(elemSeparator).map((value) => {
            if (value === '*')
              value = '.*'
            return new RegExp(['^', value, '$'].join(''), 'i')
          })

          if (list[0]!.test(node.name)) {
            for (const [n, v] of Object.entries(node.attributes)) {
              const isCurrentColor = v.toLowerCase() === 'currentcolor'
              const isFillCurrentColor = preserveCurrentColor && n === 'fill' && isCurrentColor
              const isStrokeCurrentColor = preserveCurrentColor && n === 'stroke' && isCurrentColor
              if (
                !isFillCurrentColor
                && !isStrokeCurrentColor
                && list[1]!.test(n)
                && list[2]!.test(v)
              ) {
                delete node.attributes[n]
              }
            }
          }
        }
      },
    },
  }
}
