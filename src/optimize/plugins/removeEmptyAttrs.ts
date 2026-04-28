/** Remove attributes with empty string values (excluding conditional-processing attrs). (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { attrsGroups } from './_collections'

export const name = 'removeEmptyAttrs'
export const description = 'removes empty attributes'

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      for (const [n, v] of Object.entries(node.attributes)) {
        if (v === '' && !attrsGroups.conditionalProcessing!.has(n))
          delete node.attributes[n]
      }
    },
  },
})
