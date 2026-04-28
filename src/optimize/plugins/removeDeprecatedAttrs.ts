/** Strip attributes deprecated in SVG 2. (Adapted from SVGO, MIT.) */

import type { AttrsGroupsDeprecated } from './_collections'
import type { Plugin, Stylesheet, XastElement } from '../types'
import { cssWhat as csswhat } from '@stacksjs/ts-css'
import { collectStylesheet } from '../style'
import { attrsGroupsDeprecated, elems } from './_collections'

export interface RemoveDeprecatedAttrsParams {
  removeUnsafe?: boolean
}

export const name = 'removeDeprecatedAttrs'
export const description = 'removes deprecated attributes'

function extractAttributesInStylesheet(stylesheet: Stylesheet): Set<string> {
  const attrs = new Set<string>()
  stylesheet.rules.forEach((rule) => {
    const selectors = csswhat.parse(rule.selector)
    selectors.forEach((sub) => {
      sub.forEach((segment) => {
        if (segment.type !== 'attribute')
          return
        attrs.add(segment.name)
      })
    })
  })
  return attrs
}

function processAttributes(
  node: XastElement,
  deprecatedAttrs: AttrsGroupsDeprecated | undefined,
  params: RemoveDeprecatedAttrsParams,
  attributesInStylesheet: Set<string>,
): void {
  if (!deprecatedAttrs)
    return

  if (deprecatedAttrs.safe) {
    deprecatedAttrs.safe.forEach((n) => {
      if (attributesInStylesheet.has(n))
        return
      delete node.attributes[n]
    })
  }
  if (params.removeUnsafe && deprecatedAttrs.unsafe) {
    deprecatedAttrs.unsafe.forEach((n) => {
      if (attributesInStylesheet.has(n))
        return
      delete node.attributes[n]
    })
  }
}

export const fn: Plugin<RemoveDeprecatedAttrsParams> = (root, params) => {
  const stylesheet = collectStylesheet(root)
  const attributesInStylesheet = extractAttributesInStylesheet(stylesheet)

  return {
    element: {
      enter: (node) => {
        const elemConfig = elems[node.name]
        if (!elemConfig)
          return

        if (
          elemConfig.attrsGroups.has('core')
          && node.attributes['xml:lang']
          && !attributesInStylesheet.has('xml:lang')
          && node.attributes.lang
        ) {
          delete node.attributes['xml:lang']
        }

        elemConfig.attrsGroups.forEach((group) => {
          processAttributes(node, attrsGroupsDeprecated[group], params || {}, attributesInStylesheet)
        })

        processAttributes(node, elemConfig.deprecated, params || {}, attributesInStylesheet)
      },
    },
  }
}
