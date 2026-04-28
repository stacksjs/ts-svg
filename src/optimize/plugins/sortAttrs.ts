/** Reorder element attributes deterministically (better gzip ratio). (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export interface SortAttrsParams {
  order?: ReadonlyArray<string>
  xmlnsOrder?: 'front' | 'alphabetical'
}

export const name = 'sortAttrs'
export const description = 'Sort element attributes for better compression'

export const fn: Plugin<SortAttrsParams> = (_root, params) => {
  const {
    order = ['id', 'width', 'height', 'x', 'x1', 'x2', 'y', 'y1', 'y2', 'cx', 'cy', 'r', 'fill', 'stroke', 'marker', 'd', 'points'],
    xmlnsOrder = 'front',
  } = params || {}

  const getNsPriority = (n: string): number => {
    if (xmlnsOrder === 'front') {
      if (n === 'xmlns')
        return 3
      if (n.startsWith('xmlns:'))
        return 2
    }
    if (n.includes(':'))
      return 1
    return 0
  }

  const compareAttrs = ([aName]: [string, string], [bName]: [string, string]): number => {
    const aPriority = getNsPriority(aName)
    const bPriority = getNsPriority(bName)
    const priorityNs = bPriority - aPriority
    if (priorityNs !== 0)
      return priorityNs
    const [aPart] = aName.split('-')
    const [bPart] = bName.split('-')
    if (aPart !== bPart) {
      const aInOrderFlag = order.includes(aPart!) ? 1 : 0
      const bInOrderFlag = order.includes(bPart!) ? 1 : 0
      if (aInOrderFlag === 1 && bInOrderFlag === 1)
        return order.indexOf(aPart!) - order.indexOf(bPart!)
      const priorityOrder = bInOrderFlag - aInOrderFlag
      if (priorityOrder !== 0)
        return priorityOrder
    }
    return aName < bName ? -1 : 1
  }

  return {
    element: {
      enter: (node) => {
        const attrs = Object.entries(node.attributes) as Array<[string, string]>
        attrs.sort(compareAttrs)
        const sorted: Record<string, string> = {}
        for (const [n, v] of attrs)
          sorted[n] = v
        node.attributes = sorted
      },
    },
  }
}
