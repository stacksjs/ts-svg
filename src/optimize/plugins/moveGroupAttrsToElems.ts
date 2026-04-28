/** Push a `<g transform>` down onto each path/group/text child (so applyTransforms can fold it). (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { includesUrlReference } from '../tools'
import { pathElems, referencesProps } from './_collections'

export const name = 'moveGroupAttrsToElems'
export const description = 'moves some group attributes to the content elements'

const pathElemsWithGroupsAndText = [...pathElems, 'g', 'text']

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      if (
        node.name === 'g'
        && node.children.length !== 0
        && node.attributes.transform != null
        && !Object.entries(node.attributes).some(
          ([n, v]) => referencesProps.has(n) && includesUrlReference(v),
        )
        && node.children.every(c =>
          c.type === 'element'
          && pathElemsWithGroupsAndText.includes(c.name)
          && c.attributes.id == null,
        )
      ) {
        for (const child of node.children) {
          const value = node.attributes.transform!
          if (child.type === 'element') {
            if (child.attributes.transform != null)
              child.attributes.transform = `${value} ${child.attributes.transform}`
            else
              child.attributes.transform = value
          }
        }
        delete node.attributes.transform
      }
    },
  },
})
