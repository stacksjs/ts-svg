/** Add attributes to the outermost `<svg>` element. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'

export interface AddAttributesToSVGElementParams {
  attribute?: string | Record<string, null | string>
  attributes?: Array<string | Record<string, null | string>>
}

export const name = 'addAttributesToSVGElement'
export const description = 'adds attributes to an outer <svg> element'

const ENOCLS = `Error in plugin "addAttributesToSVGElement": absent parameters.
It should have a list of "attributes" or one "attribute".`

export const fn: Plugin<AddAttributesToSVGElementParams> = (_root, params) => {
  if (!params || (!Array.isArray(params.attributes) && !params.attribute)) {
    console.error(ENOCLS)
    return null
  }
  const attributes = params.attributes || [params.attribute!]
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'svg' && parentNode.type === 'root') {
          for (const attribute of attributes) {
            if (typeof attribute === 'string') {
              if (node.attributes[attribute] == null)
                node.attributes[attribute] = undefined as any
            }
            if (typeof attribute === 'object' && attribute != null) {
              for (const key of Object.keys(attribute)) {
                if (node.attributes[key] == null)
                  node.attributes[key] = attribute[key] as any
              }
            }
          }
        }
      },
    },
  }
}
