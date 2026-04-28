/** Drop redundant viewBox when width/height already imply it. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export const name = 'removeViewBox'
export const description = 'removes viewBox attribute when possible'

const viewBoxElems = new Set(['pattern', 'svg', 'symbol'])

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (
        viewBoxElems.has(node.name)
        && node.attributes.viewBox != null
        && node.attributes.width != null
        && node.attributes.height != null
      ) {
        if (node.name === 'svg' && parentNode.type !== 'root')
          return
        const numbers = node.attributes.viewBox.split(/[ ,]+/g)
        if (
          numbers[0] === '0'
          && numbers[1] === '0'
          && node.attributes.width.replace(/px$/, '') === numbers[2]
          && node.attributes.height.replace(/px$/, '') === numbers[3]
        ) {
          delete node.attributes.viewBox
        }
      }
    },
  },
})
