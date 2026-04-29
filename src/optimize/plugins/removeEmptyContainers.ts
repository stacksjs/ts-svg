/** Remove empty container elements; cascade-removes `<use>` referencing them. (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement, XastParent } from '../types'
import { collectStylesheet, computeStyle } from '../style'
import { findReferences } from '../tools'
import { detachNodeFromParent } from '../xast'
import { elemsGroups } from './_collections'

export const name = 'removeEmptyContainers'
export const description = 'removes empty container elements'

export const fn: Plugin = (root) => {
  const stylesheet = collectStylesheet(root)
  const removedIds = new Set<string>()
  const usesById = new Map<string, Array<{ node: XastElement, parent: XastParent }>>()

  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'use') {
          const attrs = node.attributes
          for (const n in attrs) {
            const v = attrs[n]!
            const ids = findReferences(n, v)
            for (const id of ids) {
              let refs = usesById.get(id)
              if (refs === undefined) {
                refs = []
                usesById.set(id, refs)
              }
              refs.push({ node, parent: parentNode })
            }
          }
        }
      },
      exit: (node, parentNode) => {
        if (
          node.name === 'svg'
          || !elemsGroups.container!.has(node.name)
          || node.children.length !== 0
        ) {
          return
        }
        if (node.name === 'pattern' && Object.keys(node.attributes).length !== 0)
          return
        if (node.name === 'mask' && node.attributes.id != null)
          return
        if (parentNode.type === 'element' && parentNode.name === 'switch')
          return
        if (
          node.name === 'g'
          && (node.attributes.filter != null || computeStyle(stylesheet, node).filter)
        ) {
          return
        }
        detachNodeFromParent(node, parentNode)
        if (node.attributes.id)
          removedIds.add(node.attributes.id)
      },
    },
    root: {
      exit: () => {
        for (const id of removedIds) {
          const uses = usesById.get(id)
          if (uses) {
            for (const use of uses)
              detachNodeFromParent(use.node, use.parent)
          }
        }
      },
    },
  }
}
