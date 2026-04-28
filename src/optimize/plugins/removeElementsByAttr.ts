/** Remove elements by id or class match. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export interface RemoveElementsByAttrParams {
  id?: string | string[]
  class?: string | string[]
}

export const name = 'removeElementsByAttr'
export const description = 'removes arbitrary elements by ID or className'

export const fn: Plugin<RemoveElementsByAttrParams> = (_root, params) => {
  const ids = params?.id == null ? [] : Array.isArray(params.id) ? params.id : [params.id]
  const classes = params?.class == null ? [] : Array.isArray(params.class) ? params.class : [params.class]
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.attributes.id != null && ids.length !== 0) {
          if (ids.includes(node.attributes.id))
            detachNodeFromParent(node, parentNode)
        }
        if (node.attributes.class && classes.length !== 0) {
          const classList = node.attributes.class.split(' ')
          for (const item of classes) {
            if (classList.includes(item)) {
              detachNodeFromParent(node, parentNode)
              break
            }
          }
        }
      },
    },
  }
}
