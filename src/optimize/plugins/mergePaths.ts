/** Concatenate adjacent `<path>`s with identical attributes when their fills don't overlap. (Adapted from SVGO, MIT.) */

import type { ComputedStyles, PathDataItem, Plugin, XastChild, XastElement } from '../types'
import { collectStylesheet, computeStyle } from '../style'
import { includesUrlReference } from '../tools'
import { intersects, js2path, path2js } from './_path'

export interface MergePathsParams {
  force?: boolean
  floatPrecision?: number
  noSpaceAfterFlags?: boolean
}

export const name = 'mergePaths'
export const description = 'merges multiple paths in one if possible'

function elementHasUrl(computedStyle: ComputedStyles, attName: string): boolean {
  const style = computedStyle[attName]
  if (style?.type === 'static')
    return includesUrlReference(style.value)
  return false
}

export const fn: Plugin<MergePathsParams> = (root, params) => {
  const { force = false, floatPrecision = 3, noSpaceAfterFlags = false } = params || {}
  const stylesheet = collectStylesheet(root)

  return {
    element: {
      enter: (node) => {
        if (node.children.length <= 1)
          return
        const elementsToRemove = new Set<XastChild>()
        let prevChild: XastChild = node.children[0]!
        let prevPathData: PathDataItem[] | null = null

        const updatePreviousPath = (child: XastElement, pathData: ReadonlyArray<PathDataItem>): void => {
          js2path(child, pathData, { floatPrecision, noSpaceAfterFlags })
          prevPathData = null
        }

        for (let i = 1; i < node.children.length; i++) {
          const child = node.children[i]!
          if (
            prevChild.type !== 'element'
            || prevChild.name !== 'path'
            || prevChild.children.length !== 0
            || prevChild.attributes.d == null
          ) {
            if (prevPathData && prevChild.type === 'element')
              updatePreviousPath(prevChild as XastElement, prevPathData)
            prevChild = child
            continue
          }
          if (
            child.type !== 'element'
            || child.name !== 'path'
            || child.children.length !== 0
            || child.attributes.d == null
          ) {
            if (prevPathData)
              updatePreviousPath(prevChild as XastElement, prevPathData)
            prevChild = child
            continue
          }

          const computedStyle = computeStyle(stylesheet, child)
          if (
            computedStyle['marker-start']
            || computedStyle['marker-mid']
            || computedStyle['marker-end']
            || computedStyle['clip-path']
            || computedStyle.mask
            || computedStyle['mask-image']
            || ['fill', 'filter', 'stroke'].some(attName => elementHasUrl(computedStyle, attName))
          ) {
            if (prevPathData)
              updatePreviousPath(prevChild as XastElement, prevPathData)
            prevChild = child
            continue
          }
          const childAttrs = Object.keys(child.attributes)
          if (childAttrs.length !== Object.keys((prevChild as XastElement).attributes).length) {
            if (prevPathData)
              updatePreviousPath(prevChild as XastElement, prevPathData)
            prevChild = child
            continue
          }

          const areAttrsEqual = childAttrs.some(attr =>
            attr !== 'd'
            && prevChild.type === 'element'
            && (prevChild as XastElement).attributes[attr] !== child.attributes[attr],
          )
          if (areAttrsEqual) {
            if (prevPathData)
              updatePreviousPath(prevChild as XastElement, prevPathData)
            prevChild = child
            continue
          }

          const hasPrevPath = prevPathData != null
          const currentPathData = path2js(child)
          prevPathData = prevPathData ?? path2js(prevChild as XastElement)

          if (force || !intersects(prevPathData, currentPathData)) {
            prevPathData.push(...currentPathData)
            elementsToRemove.add(child)
            continue
          }

          if (hasPrevPath)
            updatePreviousPath(prevChild as XastElement, prevPathData)

          prevChild = child
          prevPathData = null
        }

        if (prevPathData && prevChild.type === 'element')
          updatePreviousPath(prevChild as XastElement, prevPathData)

        node.children = node.children.filter(c => !elementsToRemove.has(c))
      },
    },
  }
}
