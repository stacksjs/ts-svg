/** Add class names to the outermost `<svg>` element. (Adapted from SVGO, MIT.) */

import type { Plugin, PluginInfo, XastElement } from '../types'

// eslint-disable-next-line pickier/no-unused-vars
export type ClassNameProducer = string | ((node: XastElement, info: PluginInfo) => string)

export interface AddClassesToSVGElementParams {
  className?: ClassNameProducer
  classNames?: ClassNameProducer[]
}

export const name = 'addClassesToSVGElement'
export const description = 'adds classnames to an outer <svg> element'

const ENOCLS = `Error in plugin "addClassesToSVGElement": absent parameters.`

export const fn: Plugin<AddClassesToSVGElementParams> = (_root, params, info) => {
  if (
    !(params && Array.isArray(params.classNames) && params.classNames.length !== 0)
    && !params?.className
  ) {
    console.error(ENOCLS)
    return null
  }
  const classNames = params!.classNames || [params!.className!]
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'svg' && parentNode.type === 'root') {
          const classList = new Set(node.attributes.class == null ? null : node.attributes.class.split(' '))
          for (const className of classNames) {
            if (className != null) {
              const classToAdd = typeof className === 'string' ? className : className(node, info)
              classList.add(classToAdd)
            }
          }
          node.attributes.class = Array.from(classList).join(' ')
        }
      },
    },
  }
}
