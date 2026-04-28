/** Strip unknown attributes/elements and any attribute equal to its SVG default. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { collectStylesheet, computeStyle, includesAttrSelector } from '../style'
import { visitSkip } from '../util/visit'
import { detachNodeFromParent } from '../xast'
import {
  attrsGroups,
  attrsGroupsDefaults,
  elems,
  elemsGroups,
  presentationNonInheritableGroupAttrs,
} from './_collections'

export interface RemoveUnknownsAndDefaultsParams {
  unknownContent?: boolean
  unknownAttrs?: boolean
  defaultAttrs?: boolean
  defaultMarkupDeclarations?: boolean
  uselessOverrides?: boolean
  keepDataAttrs?: boolean
  keepAriaAttrs?: boolean
  keepRoleAttr?: boolean
}

export const name = 'removeUnknownsAndDefaults'
export const description = 'removes unknown elements content and attributes, removes attrs with default values'

const allowedChildrenPerElement = new Map<string, Set<string>>()
const allowedAttributesPerElement = new Map<string, Set<string>>()
const attributesDefaultsPerElement = new Map<string, Map<string, string>>()

for (const [n, config] of Object.entries(elems)) {
  const allowedChildren = new Set<string>()
  if (config.content) {
    for (const e of config.content)
      allowedChildren.add(e)
  }
  if (config.contentGroups) {
    for (const g of config.contentGroups) {
      const group = elemsGroups[g]
      if (group) {
        for (const e of group)
          allowedChildren.add(e)
      }
    }
  }
  const allowedAttributes = new Set<string>()
  if (config.attrs) {
    for (const a of config.attrs)
      allowedAttributes.add(a)
  }
  const attributesDefaults = new Map<string, string>()
  if (config.defaults) {
    for (const [a, v] of Object.entries(config.defaults))
      attributesDefaults.set(a, v)
  }
  for (const groupName of config.attrsGroups) {
    const group = attrsGroups[groupName]
    if (group) {
      for (const a of group)
        allowedAttributes.add(a)
    }
    const groupDefaults = attrsGroupsDefaults[groupName]
    if (groupDefaults) {
      for (const [a, v] of Object.entries(groupDefaults))
        attributesDefaults.set(a, v)
    }
  }
  allowedChildrenPerElement.set(n, allowedChildren)
  allowedAttributesPerElement.set(n, allowedAttributes)
  attributesDefaultsPerElement.set(n, attributesDefaults)
}

export const fn: Plugin<RemoveUnknownsAndDefaultsParams> = (root, params) => {
  const {
    unknownContent = true,
    unknownAttrs = true,
    defaultAttrs = true,
    defaultMarkupDeclarations = true,
    uselessOverrides = true,
    keepDataAttrs = true,
    keepAriaAttrs = true,
    keepRoleAttr = false,
  } = params || {}
  const stylesheet = collectStylesheet(root)

  return {
    instruction: {
      enter: (node) => {
        if (defaultMarkupDeclarations)
          node.value = node.value.replace(/\s*standalone\s*=\s*(["'])no\1/, '')
      },
    },
    element: {
      enter: (node, parentNode) => {
        if (node.name.includes(':'))
          return
        if (node.name === 'foreignObject')
          return visitSkip

        if (unknownContent && parentNode.type === 'element') {
          const allowed = allowedChildrenPerElement.get(parentNode.name)
          if (allowed == null || allowed.size === 0) {
            if (allowedChildrenPerElement.get(node.name) == null) {
              detachNodeFromParent(node, parentNode)
              return
            }
          }
          else {
            if (!allowed.has(node.name)) {
              detachNodeFromParent(node, parentNode)
              return
            }
          }
        }

        const allowedAttributes = allowedAttributesPerElement.get(node.name)
        const attributesDefaults = attributesDefaultsPerElement.get(node.name)
        const computedParentStyle = parentNode.type === 'element'
          ? computeStyle(stylesheet, parentNode)
          : null

        for (const [n, value] of Object.entries(node.attributes)) {
          if (keepDataAttrs && n.startsWith('data-'))
            continue
          if (keepAriaAttrs && n.startsWith('aria-'))
            continue
          if (keepRoleAttr && n === 'role')
            continue
          if (n === 'xmlns')
            continue
          if (n.includes(':')) {
            const [prefix] = n.split(':')
            if (prefix !== 'xml' && prefix !== 'xlink')
              continue
          }

          if (unknownAttrs && allowedAttributes && !allowedAttributes.has(n))
            delete node.attributes[n]

          if (
            defaultAttrs
            && node.attributes.id == null
            && attributesDefaults
            && attributesDefaults.get(n) === value
          ) {
            if (
              computedParentStyle?.[n] == null
              && !stylesheet.rules.some(rule => includesAttrSelector(rule.selector, n))
            ) {
              delete node.attributes[n]
            }
          }

          if (uselessOverrides && node.attributes.id == null) {
            const style = computedParentStyle?.[n]
            if (
              !presentationNonInheritableGroupAttrs.has(n)
              && style != null
              && style.type === 'static'
              && style.value === value
            ) {
              delete node.attributes[n]
            }
          }
        }
      },
    },
  }
}
