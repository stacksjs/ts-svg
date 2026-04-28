/** Drop `xmlns` for inline-SVG embedding. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export const name = 'removeXMLNS'
export const description = 'removes xmlns attribute (for inline svg)'

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      if (node.name === 'svg')
        delete node.attributes.xmlns
    },
  },
})
