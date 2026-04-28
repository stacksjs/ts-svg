/** Remove `<title>` elements. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export const name = 'removeTitle'
export const description = 'removes <title>'

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (node.name === 'title')
        detachNodeFromParent(node, parentNode)
    },
  },
})
