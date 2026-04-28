/** Deduplicate identical `<path>`s into a `<defs>` entry referenced by `<use>`. (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement } from '../types'
import { collectStylesheet } from '../style'
import { detachNodeFromParent, querySelectorAll } from '../xast'

export const name = 'reusePaths'
export const description = 'Finds <path> elements with the same d, fill, and stroke, and converts them to <use> elements referencing a single <path> def.'

export const fn: Plugin = (root) => {
  const stylesheet = collectStylesheet(root)
  const paths = new Map<string, XastElement[]>()
  let svgDefs: XastElement | undefined
  const hrefs = new Set<string>()

  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'path' && node.attributes.d != null) {
          const d = node.attributes.d
          const fill = node.attributes.fill || ''
          const stroke = node.attributes.stroke || ''
          const key = `${d};s:${stroke};f:${fill}`
          let list = paths.get(key)
          if (list == null) {
            list = []
            paths.set(key, list)
          }
          list.push(node)
        }
        if (
          svgDefs == null
          && node.name === 'defs'
          && parentNode.type === 'element'
          && parentNode.name === 'svg'
        ) {
          svgDefs = node
        }
        if (node.name === 'use') {
          for (const n of ['href', 'xlink:href']) {
            const href = node.attributes[n]
            if (href != null && href.startsWith('#') && href.length > 1)
              hrefs.add(href.slice(1))
          }
        }
      },
      exit: (node, parentNode) => {
        if (node.name === 'svg' && parentNode.type === 'root') {
          let defsTag: XastElement = svgDefs!
          if (defsTag == null) {
            defsTag = { type: 'element', name: 'defs', attributes: {}, children: [] }
          }
          let index = 0
          for (const list of paths.values()) {
            if (list.length > 1) {
              const reusablePath: XastElement = {
                type: 'element',
                name: 'path',
                attributes: {},
                children: [],
              }
              for (const attr of ['fill', 'stroke', 'd']) {
                if (list[0]!.attributes[attr] != null)
                  reusablePath.attributes[attr] = list[0]!.attributes[attr]!
              }
              const originalId = list[0]!.attributes.id
              if (
                originalId == null
                || hrefs.has(originalId)
                || stylesheet.rules.some(rule => rule.selector === `#${originalId}`)
              ) {
                reusablePath.attributes.id = `reuse-${index++}`
              }
              else {
                reusablePath.attributes.id = originalId
                delete list[0]!.attributes.id
              }
              defsTag.children.push(reusablePath)
              for (const pathNode of list) {
                delete pathNode.attributes.d
                delete pathNode.attributes.stroke
                delete pathNode.attributes.fill

                if (defsTag.children.includes(pathNode) && pathNode.children.length === 0) {
                  if (Object.keys(pathNode.attributes).length === 0) {
                    detachNodeFromParent(pathNode, defsTag)
                    continue
                  }
                  if (
                    Object.keys(pathNode.attributes).length === 1
                    && pathNode.attributes.id != null
                  ) {
                    detachNodeFromParent(pathNode, defsTag)
                    const selector = `[xlink\\:href="#${pathNode.attributes.id}"], [href="#${pathNode.attributes.id}"]`
                    for (const child of querySelectorAll(node, selector)) {
                      if (child.type !== 'element')
                        continue
                      for (const n of ['href', 'xlink:href']) {
                        if (child.attributes[n] != null)
                          child.attributes[n] = `#${reusablePath.attributes.id}`
                      }
                    }
                    continue
                  }
                }
                pathNode.name = 'use'
                pathNode.attributes['xlink:href'] = `#${reusablePath.attributes.id}`
              }
            }
          }
          if (defsTag.children.length !== 0) {
            if (node.attributes['xmlns:xlink'] == null)
              node.attributes['xmlns:xlink'] = 'http://www.w3.org/1999/xlink'
            if (svgDefs == null)
              node.children.unshift(defsTag)
          }
        }
      },
    },
  }
}
