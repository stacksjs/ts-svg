/** Remove `<script>` elements, `on*` event attrs, and `javascript:` href targets. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'
import { attrsGroups } from './_collections'

export const name = 'removeScripts'
export const description = 'removes scripts'

const eventAttrs: ReadonlyArray<string> = [
  ...(attrsGroups.animationEvent ?? new Set()),
  ...(attrsGroups.documentEvent ?? new Set()),
  ...(attrsGroups.documentElementEvent ?? new Set()),
  ...(attrsGroups.globalEvent ?? new Set()),
  ...(attrsGroups.graphicalEvent ?? new Set()),
]

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (node.name === 'script') {
        detachNodeFromParent(node, parentNode)
        return
      }
      for (const attr of eventAttrs) {
        if (node.attributes[attr] != null)
          delete node.attributes[attr]
      }
    },
    exit: (node, parentNode) => {
      if (node.name !== 'a')
        return
      for (const attr of Object.keys(node.attributes)) {
        if (attr === 'href' || attr.endsWith(':href')) {
          if (
            node.attributes[attr] == null
            || !node.attributes[attr]!.trimStart().startsWith('javascript:')
          ) {
            continue
          }
          const index = parentNode.children.indexOf(node)
          const usefulChildren = node.children.filter(child => child.type !== 'text')
          parentNode.children.splice(index, 1, ...usefulChildren)
        }
      }
    },
  },
})
