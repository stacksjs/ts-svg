/**
 * Lightweight, allocation-friendly SVG/XML parser.
 *
 * Produces a typed `SVGRoot` element tree from an SVG source string.
 * Scope:
 *   - elements: svg, g, defs, rect, circle, ellipse, line, polygon, polyline, path, title, desc
 *   - attributes: numeric coords, viewBox, transform, fill, stroke, stroke-width, opacity
 *   - inline `style="fill: red; stroke-width: 2"` is normalised onto top-level attrs
 *
 * Out of scope (intentionally — keeps the parser tiny):
 *   - DTDs, entities beyond the five XML defaults, CDATA, processing instructions
 *   - external stylesheets, <use>, <symbol>, <pattern>, <filter>, <mask>
 *
 * The renderer treats unknown elements as transparent groups (their
 * children render with inherited style).
 */

import type { Matrix, SVGElementNode, SVGGroup, SVGNode, SVGRoot } from './types'
import { parseTransform } from './transform'

interface RawElement {
  tag: string
  attrs: Record<string, string>
  children: RawElement[]
}

const SELF_CLOSING = new Set([
  'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'use', 'image', 'br',
])

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}

function parseAttributes(s: string): Record<string, string> {
  // Match key="val" / key='val' / key=val
  const out: Record<string, string> = {}
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) != null) {
    const key = m[1]!
    const val = m[2] ?? m[3] ?? m[4] ?? ''
    out[key] = decodeEntities(val)
  }
  return out
}

/**
 * Tokenise the SVG source into a flat element tree (raw, before
 * type-specific normalisation).
 */
function parseRaw(svg: string): RawElement | null {
  // Strip XML decl, doctype, comments, CDATA — we don't render any of them.
  let src = svg
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .trim()

  // Single-pass tokeniser
  const stack: RawElement[] = []
  let root: RawElement | null = null
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    if (src[lt + 1] === '/') {
      // closing tag
      const gt = src.indexOf('>', lt)
      if (gt < 0) break
      stack.pop()
      i = gt + 1
      continue
    }
    const gt = src.indexOf('>', lt)
    if (gt < 0) break
    let inner = src.slice(lt + 1, gt)
    let selfClose = false
    if (inner.endsWith('/')) {
      selfClose = true
      inner = inner.slice(0, -1).trimEnd()
    }
    // First whitespace separates tag from attrs
    const wsIdx = inner.search(/\s/)
    const tag = (wsIdx < 0 ? inner : inner.slice(0, wsIdx)).trim()
    const attrPart = wsIdx < 0 ? '' : inner.slice(wsIdx + 1)
    const attrs = parseAttributes(attrPart)
    const node: RawElement = { tag, attrs, children: [] }
    if (stack.length === 0) root = node
    else stack[stack.length - 1]!.children.push(node)
    if (!selfClose && !SELF_CLOSING.has(tag)) {
      stack.push(node)
    }
    i = gt + 1
  }
  return root
}

function parseNumber(v: string | undefined, fallback = 0): number {
  if (v == null) return fallback
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function parseLengthPercent(v: string | undefined, base: number, fallback = 0): number {
  if (v == null) return fallback
  const t = v.trim()
  if (t.endsWith('%')) {
    const n = Number.parseFloat(t.slice(0, -1))
    return Number.isFinite(n) ? (n / 100) * base : fallback
  }
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : fallback
}

function parsePoints(v: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const nums = v.split(/[\s,]+/).filter(Boolean).map(Number)
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push([nums[i]!, nums[i + 1]!])
  }
  return out
}

interface StyleAttrs {
  fill?: string | null
  stroke?: string | null
  strokeWidth?: number
  opacity?: number
  fillOpacity?: number
  strokeOpacity?: number
  transform?: Matrix
}

function pickStyle(attrs: Record<string, string>): StyleAttrs {
  // Inline style attribute is "k: v; k: v"; merge it onto attrs.
  const style = attrs.style
  if (style) {
    for (const decl of style.split(';')) {
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const k = decl.slice(0, idx).trim()
      const v = decl.slice(idx + 1).trim()
      if (!(k in attrs)) attrs[k] = v
    }
  }
  const out: StyleAttrs = {}
  if ('fill' in attrs) {
    const f = attrs.fill!.trim()
    out.fill = (f === 'none') ? null : f
  }
  if ('stroke' in attrs) {
    const s = attrs.stroke!.trim()
    out.stroke = (s === 'none') ? null : s
  }
  if ('stroke-width' in attrs) out.strokeWidth = parseNumber(attrs['stroke-width'], 1)
  if ('opacity' in attrs) out.opacity = parseNumber(attrs.opacity, 1)
  if ('fill-opacity' in attrs) out.fillOpacity = parseNumber(attrs['fill-opacity'], 1)
  if ('stroke-opacity' in attrs) out.strokeOpacity = parseNumber(attrs['stroke-opacity'], 1)
  if ('transform' in attrs) out.transform = parseTransform(attrs.transform!)
  return out
}

function buildNode(raw: RawElement, vbWidth: number, vbHeight: number): SVGNode | null {
  const attrs = { ...raw.attrs }
  const style = pickStyle(attrs)
  const baseFields = {
    attrs,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    fillOpacity: style.fillOpacity,
    strokeOpacity: style.strokeOpacity,
    opacity: style.opacity,
    transform: style.transform,
  }

  switch (raw.tag) {
    case 'g':
    case 'defs':
    case 'a': {
      const group: SVGGroup = {
        tag: 'g',
        ...baseFields,
        children: raw.children
          .map(c => buildNode(c, vbWidth, vbHeight))
          .filter((c): c is SVGNode => c != null),
      }
      return group
    }
    case 'svg': {
      // viewBox first so child %-lengths can resolve against it.
      const vb = attrs.viewBox
        ? (() => {
            const nums = attrs.viewBox.split(/[\s,]+/).filter(Boolean).map(Number)
            if (nums.length === 4) return { x: nums[0]!, y: nums[1]!, width: nums[2]!, height: nums[3]! }
            return undefined
          })()
        : undefined
      const width = parseLengthPercent(attrs.width, vb?.width ?? vbWidth, vb?.width ?? vbWidth)
      const height = parseLengthPercent(attrs.height, vb?.height ?? vbHeight, vb?.height ?? vbHeight)
      const root: SVGRoot = {
        tag: 'svg',
        ...baseFields,
        width,
        height,
        viewBox: vb,
        children: raw.children
          .map(c => buildNode(c, vb?.width ?? width, vb?.height ?? height))
          .filter((c): c is SVGNode => c != null),
      }
      return root
    }
    case 'rect': {
      const w = parseLengthPercent(attrs.width, vbWidth, 0)
      const h = parseLengthPercent(attrs.height, vbHeight, 0)
      const x = parseLengthPercent(attrs.x, vbWidth, 0)
      const y = parseLengthPercent(attrs.y, vbHeight, 0)
      const rx = attrs.rx != null ? parseLengthPercent(attrs.rx, vbWidth, 0) : undefined
      const ry = attrs.ry != null ? parseLengthPercent(attrs.ry, vbHeight, 0) : undefined
      const node = { tag: 'rect' as const, ...baseFields, x, y, width: w, height: h, rx, ry }
      return node
    }
    case 'circle':
      return {
        tag: 'circle',
        ...baseFields,
        cx: parseNumber(attrs.cx),
        cy: parseNumber(attrs.cy),
        r: parseNumber(attrs.r),
      }
    case 'ellipse':
      return {
        tag: 'ellipse',
        ...baseFields,
        cx: parseNumber(attrs.cx),
        cy: parseNumber(attrs.cy),
        rx: parseNumber(attrs.rx),
        ry: parseNumber(attrs.ry),
      }
    case 'line':
      return {
        tag: 'line',
        ...baseFields,
        x1: parseNumber(attrs.x1),
        y1: parseNumber(attrs.y1),
        x2: parseNumber(attrs.x2),
        y2: parseNumber(attrs.y2),
      }
    case 'polygon':
    case 'polyline':
      return {
        tag: raw.tag,
        ...baseFields,
        points: parsePoints(attrs.points ?? ''),
        closed: raw.tag === 'polygon',
      }
    case 'path':
      return {
        tag: 'path',
        ...baseFields,
        d: attrs.d ?? '',
      }
    case 'title':
    case 'desc':
    case 'metadata':
    case 'style':
      // Non-rendering: drop.
      return null
    default: {
      // Unknown element: treat as transparent group (renders children).
      const group: SVGGroup = {
        tag: 'g',
        ...baseFields,
        children: raw.children
          .map(c => buildNode(c, vbWidth, vbHeight))
          .filter((c): c is SVGNode => c != null),
      }
      return group
    }
  }
}

/**
 * Parse an SVG source string into a typed element tree.
 *
 * Throws if the input doesn't contain a top-level `<svg>` element.
 */
export function parseSVG(svg: string): SVGRoot {
  const raw = parseRaw(svg)
  if (!raw || raw.tag !== 'svg') {
    throw new Error('parseSVG: input did not contain a top-level <svg> element')
  }
  // Initial fallback dims (before we know viewBox/width); the SVG node
  // resolves its own from attributes.
  const result = buildNode(raw, 1000, 1000) as SVGRoot
  return result
}

export type { SVGElementNode, SVGGroup, SVGNode, SVGRoot } from './types'
