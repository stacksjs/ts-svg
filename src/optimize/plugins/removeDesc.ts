/** Remove <desc> elements that only contain editor-generated boilerplate. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export interface RemoveDescParams {
  removeAny?: boolean
}

export const name = 'removeDesc'
export const description = 'removes <desc>'

const standardDescs = /^(?:Created with|Created using)/

export const fn: Plugin<RemoveDescParams> = (_root, params) => {
  const { removeAny = false } = params || {}
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'desc') {
          if (
            removeAny
            || node.children.length === 0
            || (node.children[0]!.type === 'text'
              && standardDescs.test((node.children[0] as { value: string }).value))
          ) {
            detachNodeFromParent(node, parentNode)
          }
        }
      },
    },
  }
}
