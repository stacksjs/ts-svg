/** Reorder `<defs>` children by frequency and length. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export const name = 'sortDefsChildren'
export const description = 'Sorts children of <defs> to improve compression'

export const fn: Plugin = () => ({
  element: {
    enter: (node) => {
      if (node.name === 'defs') {
        const frequencies = new Map<string, number>()
        for (const child of node.children) {
          if (child.type === 'element')
            frequencies.set(child.name, (frequencies.get(child.name) ?? 0) + 1)
        }
        node.children.sort((a, b) => {
          if (a.type !== 'element' || b.type !== 'element')
            return 0
          const aFreq = frequencies.get(a.name)
          const bFreq = frequencies.get(b.name)
          if (aFreq != null && bFreq != null) {
            const fc = bFreq - aFreq
            if (fc !== 0)
              return fc
          }
          const lc = b.name.length - a.name.length
          if (lc !== 0)
            return lc
          if (a.name !== b.name)
            return a.name > b.name ? -1 : 1
          return 0
        })
      }
    },
  },
})
