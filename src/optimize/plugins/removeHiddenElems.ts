/** Remove zero-sized / hidden / empty-data SVG elements (and any references to them). (Adapted from SVGO, MIT.) */

import type { Plugin, XastChild, XastElement, XastParent } from '../types'
import { parsePathData } from '../path'
import { collectStylesheet, computeStyle } from '../style'
import { findReferences, hasScripts } from '../tools'
import { visit, visitSkip } from '../util/visit'
import { detachNodeFromParent, querySelector } from '../xast'
import { elemsGroups } from './_collections'

const nonRendering = elemsGroups.nonRendering!

export interface RemoveHiddenElemsParams {
  isHidden?: boolean
  displayNone?: boolean
  opacity0?: boolean
  circleR0?: boolean
  ellipseRX0?: boolean
  ellipseRY0?: boolean
  rectWidth0?: boolean
  rectHeight0?: boolean
  patternWidth0?: boolean
  patternHeight0?: boolean
  imageWidth0?: boolean
  imageHeight0?: boolean
  pathEmptyD?: boolean
  polylineEmptyPoints?: boolean
  polygonEmptyPoints?: boolean
}

export const name = 'removeHiddenElems'
export const description = 'removes hidden elements (zero sized, with absent attributes)'

export const fn: Plugin<RemoveHiddenElemsParams> = (root, params) => {
  const {
    isHidden = true,
    displayNone = true,
    opacity0 = true,
    circleR0 = true,
    ellipseRX0 = true,
    ellipseRY0 = true,
    rectWidth0 = true,
    rectHeight0 = true,
    patternWidth0 = true,
    patternHeight0 = true,
    imageWidth0 = true,
    imageHeight0 = true,
    pathEmptyD = true,
    polylineEmptyPoints = true,
    polygonEmptyPoints = true,
  } = params || {}
  const stylesheet = collectStylesheet(root)

  const nonRenderedNodes = new Map<XastElement, XastParent>()
  const removedDefIds = new Set<string>()
  const allDefs = new Map<XastElement, XastParent>()
  const allReferences = new Set<string>()
  const referencesById = new Map<string, Array<{ node: XastElement, parentNode: XastParent }>>()
  let deoptimized = false

  function canRemoveNonRenderingNode(node: XastElement): boolean {
    if (allReferences.has(node.attributes.id!))
      return false
    for (const child of node.children) {
      if (child.type === 'element' && !canRemoveNonRenderingNode(child))
        return false
    }
    return true
  }

  function removeElement(node: XastChild, parentNode: XastParent): void {
    if (
      node.type === 'element'
      && node.attributes.id != null
      && parentNode.type === 'element'
      && parentNode.name === 'defs'
    ) {
      removedDefIds.add(node.attributes.id)
    }
    detachNodeFromParent(node, parentNode)
  }

  visit(root, {
    element: {
      enter: (node, parentNode) => {
        if (nonRendering.has(node.name)) {
          nonRenderedNodes.set(node, parentNode)
          return visitSkip
        }
        const computedStyle = computeStyle(stylesheet, node)
        if (
          opacity0
          && computedStyle.opacity
          && computedStyle.opacity.type === 'static'
          && computedStyle.opacity.value === '0'
        ) {
          if (node.name === 'path') {
            nonRenderedNodes.set(node, parentNode)
            return visitSkip
          }
          removeElement(node, parentNode)
        }
      },
    },
  })

  return {
    element: {
      enter: (node, parentNode) => {
        if ((node.name === 'style' && node.children.length !== 0) || hasScripts(node)) {
          deoptimized = true
          return
        }
        if (node.name === 'defs')
          allDefs.set(node, parentNode)

        if (node.name === 'use') {
          for (const attr of Object.keys(node.attributes)) {
            if (attr !== 'href' && !attr.endsWith(':href'))
              continue
            const value = node.attributes[attr]!
            const id = value.slice(1)
            let refs = referencesById.get(id)
            if (!refs) {
              refs = []
              referencesById.set(id, refs)
            }
            refs.push({ node, parentNode })
          }
        }

        if (circleR0 && node.name === 'circle' && node.children.length === 0 && node.attributes.r === '0') {
          removeElement(node, parentNode)
          return
        }
        if (ellipseRX0 && node.name === 'ellipse' && node.children.length === 0 && node.attributes.rx === '0') {
          removeElement(node, parentNode)
          return
        }
        if (ellipseRY0 && node.name === 'ellipse' && node.children.length === 0 && node.attributes.ry === '0') {
          removeElement(node, parentNode)
          return
        }
        if (rectWidth0 && node.name === 'rect' && node.children.length === 0 && node.attributes.width === '0') {
          removeElement(node, parentNode)
          return
        }
        if (rectHeight0 && rectWidth0 && node.name === 'rect' && node.children.length === 0 && node.attributes.height === '0') {
          removeElement(node, parentNode)
          return
        }
        if (patternWidth0 && node.name === 'pattern' && node.attributes.width === '0') {
          removeElement(node, parentNode)
          return
        }
        if (patternHeight0 && node.name === 'pattern' && node.attributes.height === '0') {
          removeElement(node, parentNode)
          return
        }
        if (imageWidth0 && node.name === 'image' && node.attributes.width === '0') {
          removeElement(node, parentNode)
          return
        }
        if (imageHeight0 && node.name === 'image' && node.attributes.height === '0') {
          removeElement(node, parentNode)
          return
        }
        if (polylineEmptyPoints && node.name === 'polyline' && node.attributes.points == null) {
          removeElement(node, parentNode)
          return
        }
        if (polygonEmptyPoints && node.name === 'polygon' && node.attributes.points == null) {
          removeElement(node, parentNode)
          return
        }

        const computedStyle = computeStyle(stylesheet, node)
        if (
          isHidden
          && computedStyle.visibility
          && computedStyle.visibility.type === 'static'
          && computedStyle.visibility.value === 'hidden'
          && querySelector(node, '[visibility=visible]') == null
        ) {
          removeElement(node, parentNode)
          return
        }

        if (
          displayNone
          && computedStyle.display
          && computedStyle.display.type === 'static'
          && computedStyle.display.value === 'none'
          && node.name !== 'marker'
        ) {
          removeElement(node, parentNode)
          return
        }

        if (pathEmptyD && node.name === 'path') {
          if (node.attributes.d == null) {
            removeElement(node, parentNode)
            return
          }
          const pathData = parsePathData(node.attributes.d)
          if (pathData.length === 0) {
            removeElement(node, parentNode)
            return
          }
          if (
            pathData.length === 1
            && computedStyle['marker-start'] == null
            && computedStyle['marker-end'] == null
          ) {
            removeElement(node, parentNode)
            return
          }
        }

        const attrs = node.attributes
        for (const n in attrs) {
          const ids = findReferences(n, attrs[n]!)
          for (const id of ids)
            allReferences.add(id)
        }
      },
    },
    root: {
      exit: () => {
        for (const id of removedDefIds) {
          const refs = referencesById.get(id)
          if (refs) {
            for (const { node, parentNode } of refs)
              detachNodeFromParent(node, parentNode)
          }
        }
        if (!deoptimized) {
          for (const [n, p] of nonRenderedNodes.entries()) {
            if (canRemoveNonRenderingNode(n))
              detachNodeFromParent(n, p)
          }
        }
        for (const [n, p] of allDefs.entries()) {
          if (n.children.length === 0)
            detachNodeFromParent(n, p)
        }
      },
    },
  }
}
