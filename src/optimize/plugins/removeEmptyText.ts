/** Remove empty `<text>`, `<tspan>`, and href-less `<tref>` elements. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export interface RemoveEmptyTextParams {
  text?: boolean
  tspan?: boolean
  tref?: boolean
}

export const name = 'removeEmptyText'
export const description = 'removes empty <text> elements'

export const fn: Plugin<RemoveEmptyTextParams> = (_root, params) => {
  const { text = true, tspan = true, tref = true } = params || {}
  return {
    element: {
      enter: (node, parentNode) => {
        if (text && node.name === 'text' && node.children.length === 0)
          detachNodeFromParent(node, parentNode)
        if (tspan && node.name === 'tspan' && node.children.length === 0)
          detachNodeFromParent(node, parentNode)
        if (tref && node.name === 'tref' && node.attributes['xlink:href'] == null)
          detachNodeFromParent(node, parentNode)
      },
    },
  }
}
