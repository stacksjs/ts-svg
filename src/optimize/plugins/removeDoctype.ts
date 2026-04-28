/** Remove DOCTYPE declaration. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export const name = 'removeDoctype'
export const description = 'removes doctype declaration'

export const fn: Plugin = () => ({
  doctype: {
    enter: (node, parentNode) => {
      detachNodeFromParent(node, parentNode)
    },
  },
})
