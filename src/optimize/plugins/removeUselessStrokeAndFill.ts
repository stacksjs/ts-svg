/** Drop stroke/fill attributes that don't visibly contribute (and optionally the element). (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { collectStylesheet, computeStyle } from '../style'
import { hasScripts } from '../tools'
import { visit, visitSkip } from '../util/visit'
import { detachNodeFromParent } from '../xast'
import { elemsGroups } from './_collections'

export interface RemoveUselessStrokeAndFillParams {
  stroke?: boolean
  fill?: boolean
  removeNone?: boolean
}

export const name = 'removeUselessStrokeAndFill'
export const description = 'removes useless stroke and fill attributes'

export const fn: Plugin<RemoveUselessStrokeAndFillParams> = (root, params) => {
  const {
    stroke: removeStroke = true,
    fill: removeFill = true,
    removeNone = false,
  } = params || {}

  let hasStyleOrScript = false
  visit(root, {
    element: {
      enter: (node) => {
        if (node.name === 'style' || hasScripts(node))
          hasStyleOrScript = true
      },
    },
  })
  if (hasStyleOrScript)
    return null

  const stylesheet = collectStylesheet(root)
  return {
    element: {
      enter: (node, parentNode) => {
        if (node.attributes.id != null)
          return visitSkip
        if (!elemsGroups.shape!.has(node.name))
          return
        const computedStyle = computeStyle(stylesheet, node)
        const stroke = computedStyle.stroke
        const strokeOpacity = computedStyle['stroke-opacity']
        const strokeWidth = computedStyle['stroke-width']
        const markerEnd = computedStyle['marker-end']
        const fill = computedStyle.fill
        const fillOpacity = computedStyle['fill-opacity']
        const computedParentStyle = parentNode.type === 'element'
          ? computeStyle(stylesheet, parentNode)
          : null
        const parentStroke = computedParentStyle == null ? null : computedParentStyle.stroke

        if (removeStroke) {
          if (
            stroke == null
            || (stroke.type === 'static' && stroke.value === 'none')
            || (strokeOpacity != null && strokeOpacity.type === 'static' && strokeOpacity.value === '0')
            || (strokeWidth != null && strokeWidth.type === 'static' && strokeWidth.value === '0')
          ) {
            if (
              (strokeWidth != null && strokeWidth.type === 'static' && strokeWidth.value === '0')
              || markerEnd == null
            ) {
              for (const n of Object.keys(node.attributes)) {
                if (n.startsWith('stroke'))
                  delete node.attributes[n]
              }
              if (parentStroke != null && parentStroke.type === 'static' && parentStroke.value !== 'none')
                node.attributes.stroke = 'none'
            }
          }
        }

        if (removeFill) {
          if (
            (fill != null && fill.type === 'static' && fill.value === 'none')
            || (fillOpacity != null && fillOpacity.type === 'static' && fillOpacity.value === '0')
          ) {
            for (const n of Object.keys(node.attributes)) {
              if (n.startsWith('fill-'))
                delete node.attributes[n]
            }
            if (fill == null || (fill.type === 'static' && fill.value !== 'none'))
              node.attributes.fill = 'none'
          }
        }

        if (removeNone) {
          if (
            (stroke == null || node.attributes.stroke === 'none')
            && ((fill != null && fill.type === 'static' && fill.value === 'none') || node.attributes.fill === 'none')
          ) {
            detachNodeFromParent(node, parentNode)
          }
        }
      },
    },
  }
}
