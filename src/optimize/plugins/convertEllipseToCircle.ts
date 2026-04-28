/** Convert `<ellipse rx="r" ry="r">` to `<circle r="r">`. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export const name = 'convertEllipseToCircle'
export const description = 'converts non-eccentric <ellipse>s to <circle>s'

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      if (node.name === 'ellipse') {
        const rx = node.attributes.rx || '0'
        const ry = node.attributes.ry || '0'
        if (rx === ry || rx === 'auto' || ry === 'auto') {
          node.name = 'circle'
          const radius = rx === 'auto' ? ry : rx
          delete node.attributes.rx
          delete node.attributes.ry
          node.attributes.r = radius
        }
      }
    },
  },
})
