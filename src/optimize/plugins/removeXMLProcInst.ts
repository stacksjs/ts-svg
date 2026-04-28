/** Remove `<?xml … ?>` processing instructions. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export const name = 'removeXMLProcInst'
export const description = 'removes XML processing instructions'

export const fn: Plugin = () => ({
  instruction: {
    enter: (node, parentNode) => {
      if (node.name === 'xml')
        detachNodeFromParent(node, parentNode)
    },
  },
})
