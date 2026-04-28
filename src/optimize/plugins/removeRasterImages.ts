/** Drop `<image>` elements pointing at raster files (jpg/png/gif). (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export const name = 'removeRasterImages'
export const description = 'removes raster images'

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (
        node.name === 'image'
        && node.attributes['xlink:href'] != null
        && /(?:\.|image\/)(?:jpe?g|png|gif)/.test(node.attributes['xlink:href'])
      ) {
        detachNodeFromParent(node, parentNode)
      }
    },
  },
})
