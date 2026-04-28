/** Hoist common inheritable attributes from `<g>`'s children up to the group. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { visit } from '../util/visit'
import { inheritableAttrs, pathElems } from './_collections'

export const name = 'moveElemsAttrsToGroup'
export const description = 'Move common attributes of group children to the group'

export const fn: Plugin = (root) => {
  let deoptimizedWithStyles = false
  visit(root, {
    element: {
      enter: (node) => {
        if (node.name === 'style')
          deoptimizedWithStyles = true
      },
    },
  })

  return {
    element: {
      exit: (node) => {
        if (node.name !== 'g' || node.children.length <= 1)
          return
        if (deoptimizedWithStyles)
          return

        const commonAttributes = new Map<string, string>()
        let initial = true
        let everyChildIsPath = true
        for (const child of node.children) {
          if (child.type === 'element') {
            if (!pathElems.has(child.name))
              everyChildIsPath = false
            if (initial) {
              initial = false
              for (const [n, v] of Object.entries(child.attributes)) {
                if (inheritableAttrs.has(n))
                  commonAttributes.set(n, v)
              }
            }
            else {
              for (const [n, v] of commonAttributes) {
                if (child.attributes[n] !== v)
                  commonAttributes.delete(n)
              }
            }
          }
        }

        if (
          node.attributes.filter != null
          || node.attributes['clip-path'] != null
          || node.attributes.mask != null
        ) {
          commonAttributes.delete('transform')
        }
        if (everyChildIsPath)
          commonAttributes.delete('transform')

        for (const [n, value] of commonAttributes) {
          if (n === 'transform') {
            if (node.attributes.transform != null)
              node.attributes.transform = `${node.attributes.transform} ${value}`
            else
              node.attributes.transform = value
          }
          else {
            node.attributes[n] = value
          }
        }
        for (const child of node.children) {
          if (child.type === 'element') {
            for (const [n] of commonAttributes)
              delete child.attributes[n]
          }
        }
      },
    },
  }
}
