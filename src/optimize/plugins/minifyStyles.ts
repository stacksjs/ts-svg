/** Pass `<style>` text and `style=` attrs through CSSO. (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement, XastParent } from '../types'
import { csso } from '@stacksjs/ts-css'
import { hasScripts } from '../tools'
import { detachNodeFromParent } from '../xast'

export interface MinifyStylesUsage {
  force?: boolean
  ids?: boolean
  classes?: boolean
  tags?: boolean
}

export interface MinifyStylesParams {
  restructure?: boolean
  forceMediaMerge?: boolean
  comments?: 'exclamation' | 'first-exclamation' | boolean
  usage?: boolean | MinifyStylesUsage
}

export const name = 'minifyStyles'
export const description = 'minifies styles and removes unused styles'

export const fn: Plugin<MinifyStylesParams> = (_root, params) => {
  const { usage, ...rest } = params || {}
  const styleElements = new Map<XastElement, XastParent>()
  const elementsWithStyleAttributes: XastElement[] = []
  const tagsUsage = new Set<string>()
  const idsUsage = new Set<string>()
  const classesUsage = new Set<string>()

  let enableTagsUsage = true
  let enableIdsUsage = true
  let enableClassesUsage = true
  let forceUsageDeoptimized = false

  if (typeof usage === 'boolean') {
    enableTagsUsage = usage
    enableIdsUsage = usage
    enableClassesUsage = usage
  }
  else if (usage) {
    enableTagsUsage = usage.tags == null ? true : usage.tags
    enableIdsUsage = usage.ids == null ? true : usage.ids
    enableClassesUsage = usage.classes == null ? true : usage.classes
    forceUsageDeoptimized = usage.force == null ? false : usage.force
  }

  let deoptimized = false

  return {
    element: {
      enter: (node, parentNode) => {
        if (hasScripts(node))
          deoptimized = true
        tagsUsage.add(node.name)
        if (node.attributes.id != null)
          idsUsage.add(node.attributes.id)
        if (node.attributes.class != null) {
          for (const c of node.attributes.class.split(/\s+/))
            classesUsage.add(c)
        }
        if (node.name === 'style' && node.children.length !== 0)
          styleElements.set(node, parentNode)
        else if (node.attributes.style != null)
          elementsWithStyleAttributes.push(node)
      },
    },
    root: {
      exit: () => {
        const cssoUsage: any = {}
        if (!deoptimized || forceUsageDeoptimized) {
          if (enableTagsUsage)
            cssoUsage.tags = Array.from(tagsUsage)
          if (enableIdsUsage)
            cssoUsage.ids = Array.from(idsUsage)
          if (enableClassesUsage)
            cssoUsage.classes = Array.from(classesUsage)
        }
        for (const [styleNode, styleNodeParent] of styleElements.entries()) {
          const first = styleNode.children[0]
          if (first && (first.type === 'text' || first.type === 'cdata')) {
            const cssText = first.value
            const minified = csso.minify(cssText, { ...rest, usage: cssoUsage } as any).css
            if (minified.length === 0) {
              detachNodeFromParent(styleNode, styleNodeParent)
              continue
            }
            if (cssText.includes('>') || cssText.includes('<')) {
              ;(first as any).type = 'cdata'
              first.value = minified
            }
            else {
              ;(first as any).type = 'text'
              first.value = minified
            }
          }
        }
        for (const node of elementsWithStyleAttributes) {
          const elemStyle = node.attributes.style!
          node.attributes.style = csso.minifyBlock(elemStyle, { ...rest } as any).css
        }
      },
    },
  }
}
