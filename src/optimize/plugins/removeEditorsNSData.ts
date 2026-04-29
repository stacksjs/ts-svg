/** Strip Inkscape/Sketch/Illustrator-style editor namespaces. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'
import { editorNamespaces } from './_collections'

export interface RemoveEditorsNSDataParams {
  additionalNamespaces?: string[]
}

export const name = 'removeEditorsNSData'
export const description = 'removes editors namespaces, elements and attributes'

export const fn: Plugin<RemoveEditorsNSDataParams> = (_root, params) => {
  let namespaces = [...editorNamespaces]
  if (params && Array.isArray(params.additionalNamespaces))
    namespaces = [...editorNamespaces, ...params.additionalNamespaces]
  const prefixes: string[] = []
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'svg') {
          const attrs = node.attributes
          for (const n in attrs) {
            if (n.startsWith('xmlns:') && namespaces.includes(attrs[n]!)) {
              prefixes.push(n.slice('xmlns:'.length))
              delete attrs[n]
            }
          }
        }
        for (const n of Object.keys(node.attributes)) {
          if (n.includes(':')) {
            const [prefix] = n.split(':')
            if (prefixes.includes(prefix!))
              delete node.attributes[n]
          }
        }
        if (node.name.includes(':')) {
          const [prefix] = node.name.split(':')
          if (prefixes.includes(prefix!))
            detachNodeFromParent(node, parentNode)
        }
      },
    },
  }
}
