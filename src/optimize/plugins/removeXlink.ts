/** Migrate `xlink:*` attributes to their SVG 2 equivalents and drop the namespace. (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement } from '../types'
import { elems } from './_collections'

export interface RemoveXlinkParams {
  includeLegacy?: boolean
}

export const name = 'removeXlink'
export const description = 'remove xlink namespace and replaces attributes with the SVG 2 equivalent where applicable'

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

const SHOW_TO_TARGET: Record<string, string> = {
  new: '_blank',
  replace: '_self',
}

const LEGACY_ELEMENTS = new Set(['cursor', 'filter', 'font-face-uri', 'glyphRef', 'tref'])

function findPrefixedAttrs(node: XastElement, prefixes: ReadonlyArray<string>, attr: string): string[] {
  return prefixes.map(p => `${p}:${attr}`).filter(a => node.attributes[a] != null)
}

export const fn: Plugin<RemoveXlinkParams> = (_root, params) => {
  const { includeLegacy } = params || {}

  const xlinkPrefixes: string[] = []
  const overriddenPrefixes: string[] = []
  const usedInLegacyElement: string[] = []

  return {
    element: {
      enter: (node) => {
        for (const [key, value] of Object.entries(node.attributes)) {
          if (key.startsWith('xmlns:')) {
            const prefix = key.split(':', 2)[1]!
            if (value === XLINK_NAMESPACE) {
              xlinkPrefixes.push(prefix)
              continue
            }
            if (xlinkPrefixes.includes(prefix))
              overriddenPrefixes.push(prefix)
          }
        }

        if (overriddenPrefixes.some(p => xlinkPrefixes.includes(p)))
          return

        const showAttrs = findPrefixedAttrs(node, xlinkPrefixes, 'show')
        let showHandled = node.attributes.target != null
        for (let i = showAttrs.length - 1; i >= 0; i--) {
          const attr = showAttrs[i]!
          const value = node.attributes[attr]!
          const mapping = SHOW_TO_TARGET[value]
          if (showHandled || mapping == null) {
            delete node.attributes[attr]
            continue
          }
          if (mapping !== elems[node.name]?.defaults?.target)
            node.attributes.target = mapping
          delete node.attributes[attr]
          showHandled = true
        }

        const titleAttrs = findPrefixedAttrs(node, xlinkPrefixes, 'title')
        for (let i = titleAttrs.length - 1; i >= 0; i--) {
          const attr = titleAttrs[i]!
          const value = node.attributes[attr]!
          const hasTitle = node.children.filter(c => c.type === 'element' && c.name === 'title')
          if (hasTitle.length > 0) {
            delete node.attributes[attr]
            continue
          }
          const titleTag: XastElement = {
            type: 'element',
            name: 'title',
            attributes: {},
            children: [{ type: 'text', value }],
          }
          node.children.unshift(titleTag)
          delete node.attributes[attr]
        }

        const hrefAttrs = findPrefixedAttrs(node, xlinkPrefixes, 'href')
        if (hrefAttrs.length > 0 && LEGACY_ELEMENTS.has(node.name) && !includeLegacy) {
          hrefAttrs.map(attr => attr.split(':', 1)[0]!).forEach(p => usedInLegacyElement.push(p))
          return
        }
        for (let i = hrefAttrs.length - 1; i >= 0; i--) {
          const attr = hrefAttrs[i]!
          const value = node.attributes[attr]!
          if (node.attributes.href != null) {
            delete node.attributes[attr]
            continue
          }
          node.attributes.href = value
          delete node.attributes[attr]
        }
      },
      exit: (node) => {
        for (const [key, value] of Object.entries(node.attributes)) {
          const [prefix, attr] = key.split(':', 2)

          if (
            xlinkPrefixes.includes(prefix!)
            && !overriddenPrefixes.includes(prefix!)
            && !usedInLegacyElement.includes(prefix!)
            && !includeLegacy
          ) {
            delete node.attributes[key]
            continue
          }

          if (key.startsWith('xmlns:') && !usedInLegacyElement.includes(attr!)) {
            if (value === XLINK_NAMESPACE) {
              const index = xlinkPrefixes.indexOf(attr!)
              if (index >= 0)
                xlinkPrefixes.splice(index, 1)
              delete node.attributes[key]
              continue
            }
            if (overriddenPrefixes.includes(prefix!)) {
              const index = overriddenPrefixes.indexOf(attr!)
              if (index >= 0)
                overriddenPrefixes.splice(index, 1)
            }
          }
        }
      },
    },
  }
}
