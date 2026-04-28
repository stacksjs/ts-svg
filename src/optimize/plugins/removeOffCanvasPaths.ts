/** Drop `<path>` elements whose bounding hull lies entirely outside the viewBox. (Adapted from SVGO, MIT.) */

import type { PathDataItem, Plugin } from '../types'
import { parsePathData } from '../path'
import { visitSkip } from '../util/visit'
import { detachNodeFromParent } from '../xast'
import { intersects } from './_path'

export const name = 'removeOffCanvasPaths'
export const description = 'removes elements that are drawn outside of the viewBox'

interface ViewBox {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export const fn: Plugin = () => {
  let viewBoxData: ViewBox | null = null

  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'svg' && parentNode.type === 'root') {
          let viewBox = ''
          if (node.attributes.viewBox != null)
            viewBox = node.attributes.viewBox
          else if (node.attributes.height != null && node.attributes.width != null)
            viewBox = `0 0 ${node.attributes.width} ${node.attributes.height}`

          viewBox = viewBox
            .replace(/[,+]|px/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^\s*|\s*$/g, '')
          const m = /^(-?\d*\.?\d+) (-?\d*\.?\d+) (\d*\.?\d+) (\d*\.?\d+)$/.exec(viewBox)
          if (m == null)
            return
          const left = Number.parseFloat(m[1]!)
          const top = Number.parseFloat(m[2]!)
          const width = Number.parseFloat(m[3]!)
          const height = Number.parseFloat(m[4]!)

          viewBoxData = { left, top, right: left + width, bottom: top + height, width, height }
        }
        if (node.attributes.transform != null)
          return visitSkip

        if (node.name === 'path' && node.attributes.d != null && viewBoxData != null) {
          const pathData = parsePathData(node.attributes.d)
          let visible = false
          for (const item of pathData) {
            if (item.command === 'M') {
              const [x, y] = item.args
              if (
                x! >= viewBoxData.left
                && x! <= viewBoxData.right
                && y! >= viewBoxData.top
                && y! <= viewBoxData.bottom
              ) {
                visible = true
              }
            }
          }
          if (visible)
            return

          if (pathData.length === 2)
            pathData.push({ command: 'z', args: [] })

          const { left, top, width, height } = viewBoxData
          const viewBoxPathData: ReadonlyArray<PathDataItem> = [
            { command: 'M', args: [left, top] },
            { command: 'h', args: [width] },
            { command: 'v', args: [height] },
            { command: 'H', args: [left] },
            { command: 'z', args: [] },
          ]

          if (!intersects(viewBoxPathData, pathData))
            detachNodeFromParent(node, parentNode)
        }
      },
    },
  }
}
