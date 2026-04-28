/** Remove non-rendering elements without an id (or, when in `<defs>`, lift id-bearing children up). (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement } from '../types'
import { detachNodeFromParent } from '../xast'
import { elemsGroups } from './_collections'

export const name = 'removeUselessDefs'
export const description = 'removes elements in <defs> without id'

function collectUsefulNodes(node: XastElement, useful: XastElement[]): void {
  for (const child of node.children) {
    if (child.type === 'element') {
      if (child.attributes.id != null || child.name === 'style')
        useful.push(child)
      else
        collectUsefulNodes(child, useful)
    }
  }
}

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (
        node.name === 'defs'
        || (elemsGroups.nonRendering!.has(node.name) && node.attributes.id == null)
      ) {
        const useful: XastElement[] = []
        collectUsefulNodes(node, useful)
        if (useful.length === 0)
          detachNodeFromParent(node, parentNode)
        node.children = useful
      }
    },
  },
})
