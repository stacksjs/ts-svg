/** Drop presentation attributes on `<g>` that aren't inherited by children. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { attrsGroups, inheritableAttrs, presentationNonInheritableGroupAttrs } from './_collections'

export const name = 'removeNonInheritableGroupAttrs'
export const description = 'removes non-inheritable group\'s presentational attributes'

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      if (node.name === 'g') {
        for (const n of Object.keys(node.attributes)) {
          if (
            attrsGroups.presentation!.has(n)
            && !inheritableAttrs.has(n)
            && !presentationNonInheritableGroupAttrs.has(n)
          ) {
            delete node.attributes[n]
          }
        }
      }
    },
  },
})
