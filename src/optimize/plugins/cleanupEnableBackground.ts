/** Drop or simplify `enable-background` when no `<filter>` references it. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { csstree } from '@stacksjs/ts-css'
import { visit } from '../util/visit'

export const name = 'cleanupEnableBackground'
export const description = 'remove or cleanup enable-background attribute when possible'

const regEnableBackground = /^new\s0\s0\s([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/

function cleanupValue(value: string, nodeName: string, width: string, height: string): string | undefined {
  const match = regEnableBackground.exec(value)
  if (match != null && width === match[1] && height === match[2])
    return nodeName === 'svg' ? undefined : 'new'
  return value
}

export const fn: Plugin = (root) => {
  let hasFilter = false
  visit(root, {
    element: {
      enter: (node) => {
        if (node.name === 'filter')
          hasFilter = true
      },
    },
  })

  return {
    element: {
      enter: (node) => {
        let newStyle: any = null
        let enableBackgroundDeclaration: any = null

        if (node.attributes.style != null) {
          newStyle = csstree.parse(node.attributes.style, { context: 'declarationList' })
          if (newStyle.type === 'DeclarationList') {
            const items: any[] = []
            csstree.walk(newStyle, (n: any, nodeItem: any) => {
              if (n.type === 'Declaration' && n.property === 'enable-background') {
                items.push(nodeItem)
                enableBackgroundDeclaration = nodeItem
              }
            })
            for (let i = 0; i < items.length - 1; i++)
              newStyle.children.remove(items[i])
          }
        }

        if (!hasFilter) {
          delete node.attributes['enable-background']
          if (newStyle?.type === 'DeclarationList') {
            if (enableBackgroundDeclaration)
              newStyle.children.remove(enableBackgroundDeclaration)
            if (newStyle.children.isEmpty)
              delete node.attributes.style
            else
              node.attributes.style = csstree.generate(newStyle)
          }
          return
        }

        const hasDimensions = node.attributes.width != null && node.attributes.height != null

        if (
          (node.name === 'svg' || node.name === 'mask' || node.name === 'pattern')
          && hasDimensions
        ) {
          const attrValue = node.attributes['enable-background']!
          const attrCleaned = cleanupValue(attrValue, node.name, node.attributes.width!, node.attributes.height!)
          if (attrCleaned)
            node.attributes['enable-background'] = attrCleaned
          else
            delete node.attributes['enable-background']

          if (newStyle?.type === 'DeclarationList' && enableBackgroundDeclaration) {
            const styleValue = csstree.generate(enableBackgroundDeclaration.data.value)
            const styleCleaned = cleanupValue(styleValue, node.name, node.attributes.width!, node.attributes.height!)
            if (styleCleaned) {
              enableBackgroundDeclaration.data.value = { type: 'Raw', value: styleCleaned }
            }
            else {
              newStyle.children.remove(enableBackgroundDeclaration)
            }
          }
        }

        if (newStyle?.type === 'DeclarationList') {
          if (newStyle.children.isEmpty)
            delete node.attributes.style
          else
            node.attributes.style = csstree.generate(newStyle)
        }
      },
    },
  }
}
