/** Lift `<g>` attributes onto a sole child or eliminate attribute-less groups. (Adapted from SVGO, MIT.) */

import type { Plugin, XastNode } from '../types'
import { collectStylesheet, computeStyle } from '../style'
import { elemsGroups, inheritableAttrs } from './_collections'

export const name = 'collapseGroups'
export const description = 'collapses useless groups'

function hasAnimatedAttr(node: XastNode, n: string): boolean {
  if (node.type === 'element') {
    if (elemsGroups.animation!.has(node.name) && node.attributes.attributeName === n)
      return true
    for (const child of node.children) {
      if (hasAnimatedAttr(child, n))
        return true
    }
  }
  return false
}

export const fn: Plugin = (root) => {
  const stylesheet = collectStylesheet(root)
  return {
    element: {
      exit: (node, parentNode) => {
        if (parentNode.type === 'root' || parentNode.name === 'switch')
          return
        if (node.name !== 'g' || node.children.length === 0)
          return

        if (Object.keys(node.attributes).length !== 0 && node.children.length === 1) {
          const firstChild = node.children[0]!
          const nodeHasFilter = !!(node.attributes.filter || computeStyle(stylesheet, node).filter)
          if (
            firstChild.type === 'element'
            && firstChild.attributes.id == null
            && !nodeHasFilter
            && (node.attributes.class == null || firstChild.attributes.class == null)
            && (
              (node.attributes['clip-path'] == null && node.attributes.mask == null)
              || (firstChild.name === 'g'
                && node.attributes.transform == null
                && firstChild.attributes.transform == null)
            )
          ) {
            const newChildAttrs = { ...firstChild.attributes }
            for (const [n, value] of Object.entries(node.attributes)) {
              if (hasAnimatedAttr(firstChild, n))
                return
              if (newChildAttrs[n] == null)
                newChildAttrs[n] = value
              else if (n === 'transform')
                newChildAttrs[n] = `${value} ${newChildAttrs[n]}`
              else if (newChildAttrs[n] === 'inherit')
                newChildAttrs[n] = value
              else if (!inheritableAttrs.has(n) && newChildAttrs[n] !== value)
                return
            }
            node.attributes = {}
            firstChild.attributes = newChildAttrs
          }
        }

        if (Object.keys(node.attributes).length === 0) {
          for (const child of node.children) {
            if (child.type === 'element' && elemsGroups.animation!.has(child.name))
              return
          }
          const index = parentNode.children.indexOf(node)
          parentNode.children.splice(index, 1, ...node.children)
        }
      },
    },
  }
}
