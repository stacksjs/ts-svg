/** Remove attributes from elements that match a CSS selector. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { querySelectorAll } from '../xast'

export interface AttributesBySelector {
  selector: string
  attributes: string | string[]
}

export type RemoveAttributesBySelectorParams
  = | AttributesBySelector
    | { selectors: AttributesBySelector[] }

export const name = 'removeAttributesBySelector'
export const description = 'removes attributes of elements that match a css selector'

const ENOATTRS = `Warning: The plugin "removeAttributesBySelector" is missing parameters.
It should have a list of "selectors", or one "selector" and one "attributes".`

export const fn: Plugin<RemoveAttributesBySelectorParams> = (root, params: any) => {
  if (
    !Array.isArray(params?.selectors)
    && (!params?.selector || !params?.attributes)
  ) {
    console.warn(ENOATTRS)
    return null
  }

  const selectors: AttributesBySelector[] = Array.isArray(params.selectors) ? params.selectors : [params]
  for (const { selector, attributes } of selectors) {
    const nodes = querySelectorAll(root, selector)
    for (const node of nodes) {
      if (node.type === 'element') {
        if (Array.isArray(attributes)) {
          for (const a of attributes)
            delete node.attributes[a]
        }
        else {
          delete node.attributes[attributes]
        }
      }
    }
  }
  return {}
}
