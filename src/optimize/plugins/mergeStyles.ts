/** Concatenate every `<style>` element into one. (Adapted from SVGO, MIT.) */

import type { Plugin, XastChild, XastElement } from '../types'
import { visitSkip } from '../util/visit'
import { detachNodeFromParent } from '../xast'

export const name = 'mergeStyles'
export const description = 'merge multiple style elements into one'

export const fn: Plugin = () => {
  let firstStyleElement: XastElement | null = null
  let collectedStyles = ''
  let styleContentType: 'text' | 'cdata' = 'text'

  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'foreignObject')
          return visitSkip
        if (node.name !== 'style')
          return
        if (node.attributes.type != null && node.attributes.type !== '' && node.attributes.type !== 'text/css')
          return

        let css = ''
        for (const child of node.children) {
          if (child.type === 'text')
            css += child.value
          if (child.type === 'cdata') {
            styleContentType = 'cdata'
            css += child.value
          }
        }
        if (css.trim().length === 0) {
          detachNodeFromParent(node, parentNode)
          return
        }
        if (node.attributes.media == null) {
          collectedStyles += css
        }
        else {
          collectedStyles += `@media ${node.attributes.media}{${css}}`
          delete node.attributes.media
        }
        if (firstStyleElement == null) {
          firstStyleElement = node
        }
        else {
          detachNodeFromParent(node, parentNode)
          const child: XastChild = { type: styleContentType, value: collectedStyles } as XastChild
          firstStyleElement.children = [child]
        }
      },
    },
  }
}
