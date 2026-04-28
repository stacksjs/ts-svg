/** Convert basic shapes (rect/line/polyline/polygon, optionally circle/ellipse) to `<path>`. (Adapted from SVGO, MIT.) */

import type { PathDataItem, Plugin } from '../types'
import { stringifyPathData } from '../path'
import { detachNodeFromParent } from '../xast'

export interface ConvertShapeToPathParams {
  convertArcs?: boolean
  floatPrecision?: number
}

export const name = 'convertShapeToPath'
export const description = 'converts basic shapes to more compact path form'

const regNumber = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g

export const fn: Plugin<ConvertShapeToPathParams> = (_root, params) => {
  const { convertArcs = false, floatPrecision: precision } = params || {}
  return {
    element: {
      enter: (node, parentNode) => {
        if (
          node.name === 'rect'
          && node.attributes.width != null
          && node.attributes.height != null
          && node.attributes.rx == null
          && node.attributes.ry == null
        ) {
          const x = Number(node.attributes.x || '0')
          const y = Number(node.attributes.y || '0')
          const width = Number(node.attributes.width)
          const height = Number(node.attributes.height)
          if (Number.isNaN(x - y + width - height))
            return
          const pathData: PathDataItem[] = [
            { command: 'M', args: [x, y] },
            { command: 'H', args: [x + width] },
            { command: 'V', args: [y + height] },
            { command: 'H', args: [x] },
            { command: 'z', args: [] },
          ]
          node.name = 'path'
          node.attributes.d = stringifyPathData({ pathData, precision })
          delete node.attributes.x
          delete node.attributes.y
          delete node.attributes.width
          delete node.attributes.height
        }

        if (node.name === 'line') {
          const x1 = Number(node.attributes.x1 || '0')
          const y1 = Number(node.attributes.y1 || '0')
          const x2 = Number(node.attributes.x2 || '0')
          const y2 = Number(node.attributes.y2 || '0')
          if (Number.isNaN(x1 - y1 + x2 - y2))
            return
          const pathData: PathDataItem[] = [
            { command: 'M', args: [x1, y1] },
            { command: 'L', args: [x2, y2] },
          ]
          node.name = 'path'
          node.attributes.d = stringifyPathData({ pathData, precision })
          delete node.attributes.x1
          delete node.attributes.y1
          delete node.attributes.x2
          delete node.attributes.y2
        }

        if ((node.name === 'polyline' || node.name === 'polygon') && node.attributes.points != null) {
          const coords = (node.attributes.points.match(regNumber) || []).map(Number)
          if (coords.length < 4) {
            detachNodeFromParent(node, parentNode)
            return
          }
          const pathData: PathDataItem[] = []
          for (let i = 0; i < coords.length; i += 2) {
            pathData.push({
              command: i === 0 ? 'M' : 'L',
              args: coords.slice(i, i + 2),
            })
          }
          if (node.name === 'polygon')
            pathData.push({ command: 'z', args: [] })
          node.name = 'path'
          node.attributes.d = stringifyPathData({ pathData, precision })
          delete node.attributes.points
        }

        if (node.name === 'circle' && convertArcs) {
          const cx = Number(node.attributes.cx || '0')
          const cy = Number(node.attributes.cy || '0')
          const r = Number(node.attributes.r || '0')
          if (Number.isNaN(cx - cy + r))
            return
          const pathData: PathDataItem[] = [
            { command: 'M', args: [cx, cy - r] },
            { command: 'A', args: [r, r, 0, 1, 0, cx, cy + r] },
            { command: 'A', args: [r, r, 0, 1, 0, cx, cy - r] },
            { command: 'z', args: [] },
          ]
          node.name = 'path'
          node.attributes.d = stringifyPathData({ pathData, precision })
          delete node.attributes.cx
          delete node.attributes.cy
          delete node.attributes.r
        }

        if (node.name === 'ellipse' && convertArcs) {
          const ecx = Number(node.attributes.cx || '0')
          const ecy = Number(node.attributes.cy || '0')
          const rx = Number(node.attributes.rx || '0')
          const ry = Number(node.attributes.ry || '0')
          if (Number.isNaN(ecx - ecy + rx - ry))
            return
          const pathData: PathDataItem[] = [
            { command: 'M', args: [ecx, ecy - ry] },
            { command: 'A', args: [rx, ry, 0, 1, 0, ecx, ecy + ry] },
            { command: 'A', args: [rx, ry, 0, 1, 0, ecx, ecy - ry] },
            { command: 'z', args: [] },
          ]
          node.name = 'path'
          node.attributes.d = stringifyPathData({ pathData, precision })
          delete node.attributes.cx
          delete node.attributes.cy
          delete node.attributes.rx
          delete node.attributes.ry
        }
      },
    },
  }
}
