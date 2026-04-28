/** Trade explicit width/height for a viewBox (the inverse of removeViewBox). (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export const name = 'removeDimensions'
export const description = 'removes width and height in presence of viewBox (opposite to removeViewBox)'

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      if (node.name === 'svg') {
        if (node.attributes.viewBox != null) {
          delete node.attributes.width
          delete node.attributes.height
        }
        else if (
          node.attributes.width != null
          && node.attributes.height != null
          && !Number.isNaN(Number(node.attributes.width))
          && !Number.isNaN(Number(node.attributes.height))
        ) {
          const width = Number(node.attributes.width)
          const height = Number(node.attributes.height)
          node.attributes.viewBox = `0 0 ${width} ${height}`
          delete node.attributes.width
          delete node.attributes.height
        }
      }
    },
  },
})
