/** Remove `<metadata>` elements. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export const name = 'removeMetadata'
export const description = 'removes <metadata>'

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (node.name === 'metadata')
        detachNodeFromParent(node, parentNode)
    },
  },
})
