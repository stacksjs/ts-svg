/** Drop `xmlns:*` declarations on `<svg>` whose prefix is never referenced. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export const name = 'removeUnusedNS'
export const description = 'removes unused namespaces declaration'

export const fn: Plugin = () => {
  const unused = new Set<string>()
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'svg' && parentNode.type === 'root') {
          for (const n of Object.keys(node.attributes)) {
            if (n.startsWith('xmlns:'))
              unused.add(n.slice('xmlns:'.length))
          }
        }
        if (unused.size !== 0) {
          if (node.name.includes(':')) {
            const [ns] = node.name.split(':')
            if (unused.has(ns!))
              unused.delete(ns!)
          }
          for (const n of Object.keys(node.attributes)) {
            if (n.includes(':')) {
              const [ns] = n.split(':')
              unused.delete(ns!)
            }
          }
        }
      },
      exit: (node, parentNode) => {
        if (node.name === 'svg' && parentNode.type === 'root') {
          for (const n of unused)
            delete node.attributes[`xmlns:${n}`]
        }
      },
    },
  }
}
