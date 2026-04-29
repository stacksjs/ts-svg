/**
 * Lightweight, allocation-friendly SVG/XML parser.
 *
 * Produces a typed `SVGRoot` element tree from an SVG source string.
 *
 * Supported elements:
 *   svg, g, a, defs, symbol, rect, circle, ellipse, line, polygon, polyline,
 *   path, text, use, linearGradient, radialGradient, stop, clipPath, mask
 *
 * Supported attributes / features:
 *   - numeric coords, viewBox, preserveAspectRatio, transform
 *   - fill, stroke, stroke-width, stroke-linecap/linejoin/miterlimit/dasharray/dashoffset
 *   - opacity, fill-opacity, stroke-opacity
 *   - clip-path, mask (with `objectBoundingBox` units), `mask-type`
 *   - inline `style="…"` declarations are projected onto a per-element view
 *     (without mutating the source attrs map)
 *   - gradient `xlink:href` chaining (stops + geometry inheritance)
 *
 * Out of scope (today):
 *   - DTDs / external stylesheets / `<style>` CSS selectors
 *   - `<filter>`, `<pattern>`, `<image>`, `<tspan>` per-glyph positioning
 *   - processing instructions other than `<?xml…?>`
 *
 * The renderer treats unknown elements as transparent groups (their
 * children render with inherited style).
 */

import type { Matrix, PreserveAspectRatio, SVGClipPath, SVGDefs, SVGElementNode, SVGGradient, SVGGradientStop, SVGGroup, SVGLinearGradient, SVGMask, SVGNode, SVGRadialGradient, SVGRoot } from './types'
import { parseColor } from './color'
import { parseTransform } from './transform'

const PAR_ALIGN_VALUES = new Set([
  'none', 'xMinYMin', 'xMidYMin', 'xMaxYMin',
  'xMinYMid', 'xMidYMid', 'xMaxYMid',
  'xMinYMax', 'xMidYMax', 'xMaxYMax',
])

/** Parse a `preserveAspectRatio` attribute. SVG default is "xMidYMid meet". */
function parsePreserveAspectRatio(s: string | undefined): PreserveAspectRatio {
  if (!s) return { align: 'xMidYMid', meetOrSlice: 'meet' }
  const parts = s.trim().split(/\s+/)
  const alignRaw = parts[0] ?? 'xMidYMid'
  const align = (PAR_ALIGN_VALUES.has(alignRaw) ? alignRaw : 'xMidYMid') as PreserveAspectRatio['align']
  const meetOrSlice = (parts[1] === 'slice' ? 'slice' : 'meet') as PreserveAspectRatio['meetOrSlice']
  return { align, meetOrSlice }
}

interface RawTextNode { tag: '#text', text: string }
interface RawElement {
  tag: string
  attrs: Record<string, string>
  children: Array<RawElement | RawTextNode>
}

function collectText(el: RawElement): string {
  const out: string[] = []
  for (const c of el.children) {
    if (c.tag === '#text') out.push((c as { text: string }).text)
    else out.push(collectText(c as RawElement))
  }
  const raw = out.join('')
  // SVG `xml:space="preserve"` keeps whitespace verbatim (only newline → space
  // and tab → space normalisation). Default `xml:space="default"` collapses
  // runs of whitespace and trims edges.
  if (el.attrs['xml:space'] === 'preserve') {
    return raw.replace(/[\n\r\t]/g, ' ')
  }
  return raw.replace(/\s+/g, ' ').trim()
}

const SELF_CLOSING = new Set([
  'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'use', 'image', 'stop',
])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
}

const ENTITY_RE = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi

/**
 * Decode XML entities. Hot path: when no `&` is present (the overwhelming
 * majority of attribute values), return the original string unchanged.
 */
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(ENTITY_RE, (whole, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      if (body.charCodeAt(1) === 120 /* x */ || body.charCodeAt(1) === 88 /* X */) {
        const code = Number.parseInt(body.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    const lower = body.toLowerCase()
    if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower]!
    return whole
  })
}

/**
 * Single-pass index-based SVG/XML tokeniser → raw element tree.
 *
 * Performance notes:
 *  - No regex scans of the source — each character is visited at most twice
 *    (once for the outer `<…>` boundary scan, once for attribute parsing).
 *  - `String.charCodeAt` comparisons instead of `.startsWith` / `.indexOf`
 *    on multi-char delimiters.
 *  - `decodeEntities` early-exits for attribute values without `&`
 *    (≈100% of typical SVG content), so a 90 KB path `d=` attr costs O(1)
 *    instead of 7 regex passes over the whole string.
 *  - Comments / CDATA / DOCTYPE / `<?xml?>` are skipped inline rather than
 *    pre-stripped via four full-text `.replace()` passes.
 */
function parseRaw(svg: string): RawElement | null {
  const len = svg.length
  const stack: RawElement[] = []
  let root: RawElement | null = null
  let i = 0

  while (i < len) {
    let c = svg.charCodeAt(i)

    if (c !== 60 /* < */) {
      // Text content — read until next `<`. Track whether we ever see a
      // non-whitespace char in the same pass so we can skip allocating a
      // slice for pure-whitespace runs (the common case between sibling
      // elements in indented SVG).
      const start = i
      let allWs = c === 32 || c === 9 || c === 10 || c === 13
      i++
      while (i < len) {
        const cc = svg.charCodeAt(i)
        if (cc === 60) break
        if (allWs && cc !== 32 && cc !== 9 && cc !== 10 && cc !== 13) allWs = false
        i++
      }
      if (!allWs && stack.length > 0) {
        const text = decodeEntities(svg.slice(start, i))
        stack[stack.length - 1]!.children.push({ tag: '#text', text })
      }
      continue
    }

    // We're at `<`. Inspect the next char to dispatch.
    const next = svg.charCodeAt(i + 1)

    if (next === 33 /* ! */) {
      // <!--, <![CDATA[, <!DOCTYPE — all are skipped (we don't render them).
      if (svg.charCodeAt(i + 2) === 45 && svg.charCodeAt(i + 3) === 45) {
        // <!-- comment -->
        const end = svg.indexOf('-->', i + 4)
        i = end < 0 ? len : end + 3
        continue
      }
      if (svg.charCodeAt(i + 2) === 91 /* [ */) {
        // <![CDATA[ … ]]>
        const end = svg.indexOf(']]>', i + 9)
        i = end < 0 ? len : end + 3
        continue
      }
      // <!DOCTYPE … [internal subset]? >
      let j = i + 2
      let inSubset = false
      while (j < len) {
        const cc = svg.charCodeAt(j)
        if (cc === 91) inSubset = true
        else if (cc === 93) inSubset = false
        else if (cc === 62 && !inSubset) break
        j++
      }
      i = j + 1
      continue
    }

    if (next === 63 /* ? */) {
      // <?xml … ?> processing instruction — skip
      const end = svg.indexOf('?>', i + 2)
      i = end < 0 ? len : end + 2
      continue
    }

    if (next === 47 /* / */) {
      // closing tag </name>
      const end = svg.indexOf('>', i + 2)
      if (end < 0) break
      stack.pop()
      i = end + 1
      continue
    }

    // Opening tag `<name … >` or `<name … />`.
    const tagStart = i + 1
    let j = tagStart
    while (j < len) {
      const cc = svg.charCodeAt(j)
      if (cc === 32 || cc === 9 || cc === 10 || cc === 13 || cc === 47 || cc === 62) break
      j++
    }
    const tag = svg.slice(tagStart, j)
    const attrs: Record<string, string> = {}
    let selfClose = false

    // Attribute loop — drains until `>` or `/>`.
    while (j < len) {
      c = svg.charCodeAt(j)
      while (c === 32 || c === 9 || c === 10 || c === 13) {
        j++
        if (j >= len) break
        c = svg.charCodeAt(j)
      }
      if (j >= len) break
      if (c === 62 /* > */) { j++; break }
      if (c === 47 /* / */) {
        selfClose = true
        // tolerant: skip until `>` (Adobe-style `<rect …/>` always matches first)
        const gt = svg.indexOf('>', j)
        j = gt < 0 ? len : gt + 1
        break
      }

      const attrStart = j
      while (j < len) {
        const cc = svg.charCodeAt(j)
        if (cc === 61 /* = */ || cc === 32 || cc === 9 || cc === 10 || cc === 13 || cc === 47 || cc === 62) break
        j++
      }
      const attrName = svg.slice(attrStart, j)

      while (j < len) {
        const cc = svg.charCodeAt(j)
        if (cc !== 32 && cc !== 9 && cc !== 10 && cc !== 13) break
        j++
      }

      if (svg.charCodeAt(j) !== 61 /* = */) {
        // Boolean / valueless attribute.
        attrs[attrName] = ''
        continue
      }
      j++

      while (j < len) {
        const cc = svg.charCodeAt(j)
        if (cc !== 32 && cc !== 9 && cc !== 10 && cc !== 13) break
        j++
      }

      const quote = svg.charCodeAt(j)
      let value: string
      if (quote === 34 /* " */) {
        const close = svg.indexOf('"', j + 1)
        if (close < 0) { j = len; break }
        value = svg.slice(j + 1, close)
        j = close + 1
      }
      else if (quote === 39 /* ' */) {
        const close = svg.indexOf('\'', j + 1)
        if (close < 0) { j = len; break }
        value = svg.slice(j + 1, close)
        j = close + 1
      }
      else {
        // unquoted
        const start = j
        while (j < len) {
          const cc = svg.charCodeAt(j)
          if (cc === 32 || cc === 9 || cc === 10 || cc === 13 || cc === 47 || cc === 62) break
          j++
        }
        value = svg.slice(start, j)
      }
      attrs[attrName] = decodeEntities(value)
    }

    const node: RawElement = { tag, attrs, children: [] }
    if (stack.length === 0) root = node
    else stack[stack.length - 1]!.children.push(node)
    if (!selfClose && !SELF_CLOSING.has(tag)) {
      stack.push(node)
    }
    i = j
  }
  return root
}

function parseNumber(v: string | undefined, fallback = 0): number {
  if (v == null) return fallback
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Resolve a length-or-percentage value. Recognised unit suffixes:
 *   - `%`      → fraction of `base`
 *   - `px`     → pixels (1:1 with user units)
 *   - `pt`/`pc`/`in`/`cm`/`mm`/`Q` → physical length, converted to px at 96dpi
 *   - `em`/`rem`/`ex`/`ch` → treated as multiples of 16 (no font cascade yet)
 *   - bare number → user units
 *
 * `parseFloat` would silently strip ANY suffix and return the leading
 * number — that's correct for `px` but produced wrong results for `em`/`pt`
 * ("12em" used to render as 12 user units). The unit table below makes the
 * conversion explicit so the renderer matches expected sizing.
 */
function parseLengthPercent(v: string | undefined, base: number, fallback = 0): number {
  if (v == null) return fallback
  // Skip leading whitespace.
  const len = v.length
  let i = 0
  while (i < len) {
    const c = v.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) i++
    else break
  }
  if (i >= len) return fallback
  const numStart = i
  const sc = v.charCodeAt(i)
  if (sc === 43 || sc === 45) i++
  let sawDigit = false
  let sawDot = false
  while (i < len) {
    const c = v.charCodeAt(i)
    if (c >= 48 && c <= 57) { sawDigit = true; i++ }
    else if (c === 46 && !sawDot) { sawDot = true; i++ }
    else break
  }
  if (i < len) {
    const ec = v.charCodeAt(i)
    if (ec === 101 || ec === 69) {
      i++
      const ssc = v.charCodeAt(i)
      if (ssc === 43 || ssc === 45) i++
      while (i < len) {
        const c = v.charCodeAt(i)
        if (c >= 48 && c <= 57) i++
        else break
      }
    }
  }
  if (!sawDigit) return fallback
  const n = Number.parseFloat(v.slice(numStart, i))
  if (!Number.isFinite(n)) return fallback

  // Skip optional whitespace before unit suffix.
  while (i < len) {
    const c = v.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) i++
    else break
  }
  if (i >= len) return n
  const u0 = v.charCodeAt(i)
  // '%'  → percent of base
  if (u0 === 37) return (n / 100) * base
  // Two-letter units (px, pt, pc, in, cm, mm, em, ex, ch, rem-prefix 're')
  const u1 = i + 1 < len ? v.charCodeAt(i + 1) : 0
  // Lowercase via OR with 0x20 (only valid for ASCII letters).
  const a = u0 | 0x20
  const b = u1 | 0x20
  // px
  if (a === 112 && b === 120) return n
  // pt
  if (a === 112 && b === 116) return n * (96 / 72)
  // pc
  if (a === 112 && b === 99) return n * (96 / 6)
  // in
  if (a === 105 && b === 110) return n * 96
  // cm
  if (a === 99 && b === 109) return n * (96 / 2.54)
  // mm
  if (a === 109 && b === 109) return n * (96 / 25.4)
  // q (single letter)
  if (a === 113 && (u1 === 0 || u1 === 32)) return n * (96 / 101.6)
  // em, ex, ch — treated as 16
  if ((a === 101 && (b === 109 || b === 120)) || (a === 99 && b === 104)) return n * 16
  // rem — three letters
  if (a === 114 && b === 101 && i + 2 < len && (v.charCodeAt(i + 2) | 0x20) === 109) return n * 16
  return n
}

/**
 * Parse a `viewBox` attribute value into `{x, y, width, height}` (or
 * `undefined` if malformed). Char-code single-pass scanner — replaces
 * `value.split(/[\s,]+/).filter(Boolean).map(Number)`.
 */
function parseViewBox(v: string): { x: number, y: number, width: number, height: number } | undefined {
  const len = v.length
  let i = 0
  const nums: number[] = []
  while (i < len && nums.length < 5) {
    let c = v.charCodeAt(i)
    while (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) {
      i++
      if (i >= len) break
      c = v.charCodeAt(i)
    }
    if (i >= len) break
    const start = i
    if (c === 43 || c === 45) i++
    let sawDigit = false
    let sawDot = false
    while (i < len) {
      const cc = v.charCodeAt(i)
      if (cc >= 48 && cc <= 57) { sawDigit = true; i++ }
      else if (cc === 46 && !sawDot) { sawDot = true; i++ }
      else break
    }
    if (i < len) {
      const ec = v.charCodeAt(i)
      if (ec === 101 || ec === 69) {
        i++
        const sc = v.charCodeAt(i)
        if (sc === 43 || sc === 45) i++
        while (i < len) {
          const cc = v.charCodeAt(i)
          if (cc >= 48 && cc <= 57) i++
          else break
        }
      }
    }
    if (!sawDigit) break
    const n = Number.parseFloat(v.slice(start, i))
    if (!Number.isFinite(n)) return undefined
    nums.push(n)
  }
  if (nums.length !== 4) return undefined
  if (nums[2]! < 0 || nums[3]! < 0) return undefined
  return { x: nums[0]!, y: nums[1]!, width: nums[2]!, height: nums[3]! }
}

function parsePoints(v: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (v == null || v.length === 0) return out
  const len = v.length
  let i = 0
  let pending: number | null = null
  while (i < len) {
    let c = v.charCodeAt(i)
    while (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) {
      i++
      if (i >= len) break
      c = v.charCodeAt(i)
    }
    if (i >= len) break
    const start = i
    if (c === 43 || c === 45) i++
    let sawDigit = false
    let sawDot = false
    while (i < len) {
      const cc = v.charCodeAt(i)
      if (cc >= 48 && cc <= 57) { sawDigit = true; i++ }
      else if (cc === 46 && !sawDot) { sawDot = true; i++ }
      else break
    }
    if (i < len) {
      const ec = v.charCodeAt(i)
      if (ec === 101 || ec === 69) {
        i++
        const sc = v.charCodeAt(i)
        if (sc === 43 || sc === 45) i++
        while (i < len) {
          const cc = v.charCodeAt(i)
          if (cc >= 48 && cc <= 57) i++
          else break
        }
      }
    }
    if (!sawDigit) break
    const n = Number.parseFloat(v.slice(start, i))
    if (!Number.isFinite(n)) continue
    if (pending == null) pending = n
    else { out.push([pending, n]); pending = null }
  }
  return out
}

/**
 * Minimal CSS rule list collected from `<style>` elements.
 *
 * Selectors supported: tag name (`circle`), class (`.foo`), id (`#foo`),
 * universal (`*`), comma-separated lists. Anything more complex is ignored
 * — no descendant combinators, no pseudo-classes, no attribute selectors.
 */
interface CssRule {
  matches: (tag: string, attrs: Record<string, string>) => boolean
  declarations: string
}

function compileSelector(sel: string): CssRule['matches'] | null {
  const s = sel.trim()
  if (!s) return null
  if (s === '*') return () => true
  if (s.startsWith('.')) {
    const cls = s.slice(1)
    return (_t, a) => (a.class ?? '').split(/\s+/).includes(cls)
  }
  if (s.startsWith('#')) {
    const id = s.slice(1)
    return (_t, a) => a.id === id
  }
  if (/^[a-zA-Z][\w-]*$/.test(s)) {
    return t => t === s
  }
  return null
}

function parseStylesheet(css: string): CssRule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const re = /([^{}]+)\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) != null) {
    const selectors = m[1]!.split(',').map(s => s.trim()).filter(Boolean)
    const decls = m[2]!.trim()
    const matchers = selectors
      .map(compileSelector)
      .filter((f): f is CssRule['matches'] => f != null)
    if (matchers.length === 0 || !decls) continue
    rules.push({
      matches: (t, a) => matchers.some(f => f(t, a)),
      declarations: decls,
    })
  }
  return rules
}

function collectStylesheets(el: RawElement): CssRule[] {
  const out: CssRule[] = []
  const walk = (e: RawElement): void => {
    if (e.tag === 'style') out.push(...parseStylesheet(collectText(e)))
    for (const c of e.children) {
      if (c.tag !== '#text') walk(c as RawElement)
    }
  }
  walk(el)
  return out
}

/**
 * Apply matching stylesheet rules' declarations to an element by prepending
 * them to its `style=` attribute. Inline `style=` keeps higher precedence
 * (because `pickStyle` only writes a value if the key isn't already present).
 */
function applyStylesheets(rules: CssRule[], tag: string, attrs: Record<string, string>): void {
  if (rules.length === 0) return
  const accum: string[] = []
  for (const r of rules) {
    if (r.matches(tag, attrs)) accum.push(r.declarations)
  }
  if (accum.length === 0) return
  // pickStyle iterates the merged style string with FIRST-WINS semantics,
  // so the element's inline style must come BEFORE the stylesheet
  // declarations to take precedence (matching CSS specificity rules where
  // inline style beats author stylesheets).
  attrs.style = (attrs.style ? `${attrs.style}; ` : '') + accum.join('; ')
}

interface StyleAttrs {
  fill?: string | null
  stroke?: string | null
  strokeWidth?: number
  strokeLineCap?: 'butt' | 'round' | 'square'
  strokeLineJoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDashArray?: number[]
  strokeDashOffset?: number
  opacity?: number
  fillOpacity?: number
  strokeOpacity?: number
  transform?: Matrix
  clipPath?: string
  mask?: string
  fillRule?: 'nonzero' | 'evenodd'
  paintOrder?: ReadonlyArray<'fill' | 'stroke' | 'markers'>
  vectorEffect?: 'none' | 'non-scaling-stroke'
}

function pickStyle(rawAttrs: Record<string, string>): StyleAttrs {
  // Inline style attribute is "k: v; k: v"; project it onto a local view
  // without mutating the source attrs map (callers preserve `attrs` on the
  // node and shouldn't see synthetic keys back-written from `style`).
  //
  // Hot path: most elements have NO `style="…"` attribute, so we can skip
  // the shallow clone entirely. Only build a merged map when style is set.
  const style = rawAttrs.style
  let attrs: Record<string, string>
  if (style) {
    attrs = { ...rawAttrs }
    for (const decl of style.split(';')) {
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const k = decl.slice(0, idx).trim()
      const v = decl.slice(idx + 1).trim()
      if (!(k in attrs)) attrs[k] = v
    }
  }
  else {
    // Fast bail-out: if NO presentation attr is present (the common case for
    // structural elements like <g>, <defs>, and most <rect>/<circle>s that
    // only carry geometry), return an empty style object without running the
    // 16+ key probes below.
    if (
      rawAttrs.fill === undefined
      && rawAttrs.stroke === undefined
      && rawAttrs.transform === undefined
      && rawAttrs.opacity === undefined
      && rawAttrs['fill-opacity'] === undefined
      && rawAttrs['stroke-opacity'] === undefined
      && rawAttrs['stroke-width'] === undefined
      && rawAttrs['stroke-linecap'] === undefined
      && rawAttrs['stroke-linejoin'] === undefined
      && rawAttrs['stroke-miterlimit'] === undefined
      && rawAttrs['stroke-dasharray'] === undefined
      && rawAttrs['stroke-dashoffset'] === undefined
      && rawAttrs['clip-path'] === undefined
      && rawAttrs.mask === undefined
      && rawAttrs['fill-rule'] === undefined
      && rawAttrs['paint-order'] === undefined
      && rawAttrs['vector-effect'] === undefined
    ) {
      return {}
    }
    attrs = rawAttrs
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
  if ('stroke-width' in attrs) {
    // SVG spec: stroke-width must be non-negative; treat negative as 0
    // (per CSS Backgrounds/Borders convention) instead of inverting normals.
    const w = parseNumber(attrs['stroke-width'], 1)
    out.strokeWidth = Math.max(0, w)
  }
  if ('stroke-linecap' in attrs) {
    const cap = attrs['stroke-linecap']!.trim()
    if (cap === 'butt' || cap === 'round' || cap === 'square') out.strokeLineCap = cap
  }
  if ('stroke-linejoin' in attrs) {
    const join = attrs['stroke-linejoin']!.trim()
    if (join === 'miter' || join === 'round' || join === 'bevel') out.strokeLineJoin = join
  }
  if ('stroke-miterlimit' in attrs) out.strokeMiterLimit = parseNumber(attrs['stroke-miterlimit'], 4)
  if ('stroke-dasharray' in attrs) {
    const v = attrs['stroke-dasharray']!.trim()
    if (v && v !== 'none') {
      const parts = v.split(/[\s,]+/).filter(Boolean).map(Number)
      // Per SVG spec: if the list contains a zero value or any negative value,
      // the dash-array is invalid and rendered as solid.
      const allFinite = parts.every(n => Number.isFinite(n))
      const allNonNeg = parts.every(n => n >= 0)
      const allNonZero = parts.some(n => n > 0)
      out.strokeDashArray = (allFinite && allNonNeg && allNonZero) ? parts : []
    }
    else {
      out.strokeDashArray = []
    }
  }
  if ('stroke-dashoffset' in attrs) out.strokeDashOffset = parseNumber(attrs['stroke-dashoffset'], 0)
  if ('opacity' in attrs) out.opacity = parseNumber(attrs.opacity, 1)
  if ('fill-opacity' in attrs) out.fillOpacity = parseNumber(attrs['fill-opacity'], 1)
  if ('stroke-opacity' in attrs) out.strokeOpacity = parseNumber(attrs['stroke-opacity'], 1)
  if ('transform' in attrs) out.transform = parseTransform(attrs.transform!)
  if ('clip-path' in attrs) out.clipPath = attrs['clip-path']!.trim()
  if ('mask' in attrs) out.mask = attrs.mask!.trim()
  if ('fill-rule' in attrs) {
    const fr = attrs['fill-rule']!.trim()
    if (fr === 'nonzero' || fr === 'evenodd') out.fillRule = fr
  }
  if ('paint-order' in attrs) {
    const tokens = attrs['paint-order']!.trim().split(/\s+/).filter(Boolean) as Array<'fill' | 'stroke' | 'markers'>
    const valid = tokens.filter(t => t === 'fill' || t === 'stroke' || t === 'markers')
    // SVG 2: if a paint-order keyword is omitted, the remaining items follow
    // in their default order (fill, stroke, markers). Reconstruct the full list.
    const seen = new Set(valid)
    const full: Array<'fill' | 'stroke' | 'markers'> = [...valid]
    for (const k of ['fill', 'stroke', 'markers'] as const) {
      if (!seen.has(k)) full.push(k)
    }
    out.paintOrder = full
  }
  if ('vector-effect' in attrs) {
    const ve = attrs['vector-effect']!.trim()
    if (ve === 'none' || ve === 'non-scaling-stroke') out.vectorEffect = ve
  }
  return out
}

function buildNode(raw: RawElement, vbWidth: number, vbHeight: number): SVGNode | null {
  // raw.attrs is owned by this raw element and not shared, so we can read
  // from it directly without cloning. pickStyle() makes its own internal
  // shallow copy for style-decl projection.
  const attrs = raw.attrs
  const style = pickStyle(attrs)
  const baseFields = {
    attrs,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeLineCap: style.strokeLineCap,
    strokeLineJoin: style.strokeLineJoin,
    strokeMiterLimit: style.strokeMiterLimit,
    strokeDashArray: style.strokeDashArray,
    strokeDashOffset: style.strokeDashOffset,
    fillOpacity: style.fillOpacity,
    strokeOpacity: style.strokeOpacity,
    opacity: style.opacity,
    transform: style.transform,
    clipPath: style.clipPath,
    mask: style.mask,
    fillRule: style.fillRule,
    paintOrder: style.paintOrder,
    vectorEffect: style.vectorEffect,
  }

  switch (raw.tag) {
    case 'g':
    case 'a': {
      const group: SVGGroup = {
        tag: 'g',
        ...baseFields,
        children: raw.children
          .filter((c): c is RawElement => c.tag !== '#text')
          .map(c => buildNode(c, vbWidth, vbHeight))
          .filter((c): c is SVGNode => c != null),
      }
      return group
    }
    case 'defs':
      // <defs> contents are invisible — they only render via <use href>.
      // They are still walked by collectDefs() to populate the byId registry.
      return null
    case 'svg': {
      // viewBox first so child %-lengths can resolve against it.
      const vb = attrs.viewBox ? parseViewBox(attrs.viewBox) : undefined
      const width = parseLengthPercent(attrs.width, vb?.width ?? vbWidth, vb?.width ?? vbWidth)
      const height = parseLengthPercent(attrs.height, vb?.height ?? vbHeight, vb?.height ?? vbHeight)
      const par = parsePreserveAspectRatio(attrs.preserveAspectRatio)
      // Inner-svg `x`/`y` shift the viewport; outer-svg has no x/y.
      const x = parseLengthPercent(attrs.x, vbWidth, 0)
      const y = parseLengthPercent(attrs.y, vbHeight, 0)
      const root: SVGRoot = {
        tag: 'svg',
        ...baseFields,
        width,
        height,
        x,
        y,
        viewBox: vb,
        preserveAspectRatio: par,
        children: raw.children
          .filter((c): c is RawElement => c.tag !== '#text')
          .map(c => buildNode(c, vb?.width ?? width, vb?.height ?? height))
          .filter((c): c is SVGNode => c != null),
        defs: { gradients: new Map(), clipPaths: new Map(), masks: new Map(), byId: new Map() },
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
    case 'text': {
      const anchorRaw = attrs['text-anchor']
      const anchor = anchorRaw === 'middle' ? 'middle' : anchorRaw === 'end' ? 'end' : 'start'
      // Inner text is the concatenation of any text children (we don't
      // honour <tspan> positioning yet; the parser flattens them).
      const flat = collectText(raw)
      return {
        tag: 'text',
        ...baseFields,
        x: parseNumber(attrs.x),
        y: parseNumber(attrs.y),
        textAnchor: anchor,
        fontFamily: attrs['font-family'] ?? attrs.fontFamily ?? 'sans-serif',
        fontSize: parseNumber(attrs['font-size'] ?? attrs.fontSize, 16),
        text: flat,
      }
    }
    case 'use': {
      const href = attrs.href ?? attrs['xlink:href'] ?? ''
      return {
        tag: 'use',
        ...baseFields,
        href: href.replace(/^#/, ''),
        x: parseNumber(attrs.x),
        y: parseNumber(attrs.y),
        width: attrs.width != null ? parseLengthPercent(attrs.width, vbWidth, undefined as never) : undefined,
        height: attrs.height != null ? parseLengthPercent(attrs.height, vbHeight, undefined as never) : undefined,
      }
    }
    case 'image': {
      const href = attrs.href ?? attrs['xlink:href'] ?? ''
      const w = parseLengthPercent(attrs.width, vbWidth, 0)
      const h = parseLengthPercent(attrs.height, vbHeight, 0)
      return {
        tag: 'image',
        ...baseFields,
        href,
        x: parseLengthPercent(attrs.x, vbWidth, 0),
        y: parseLengthPercent(attrs.y, vbHeight, 0),
        width: w,
        height: h,
        preserveAspectRatio: parsePreserveAspectRatio(attrs.preserveAspectRatio),
      }
    }
    case 'linearGradient':
    case 'radialGradient':
    case 'clipPath':
    case 'mask':
    case 'pattern':
    case 'filter':
    case 'symbol':
      // Captured into defs separately; not part of the render tree.
      return null
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
          .filter((c): c is RawElement => c.tag !== '#text')
          .map(c => buildNode(c, vbWidth, vbHeight))
          .filter((c): c is SVGNode => c != null),
      }
      return group
    }
  }
}

/** Parse a single gradient stop element. */
function parseGradientStop(raw: RawElement): SVGGradientStop {
  const offsetRaw = raw.attrs.offset ?? '0'
  let offset = offsetRaw.endsWith('%')
    ? Number.parseFloat(offsetRaw.slice(0, -1)) / 100
    : Number.parseFloat(offsetRaw)
  if (!Number.isFinite(offset)) offset = 0
  offset = Math.max(0, Math.min(1, offset))

  // stop-color may come from style="stop-color: #fff; stop-opacity: 0.5".
  let stopColor = raw.attrs['stop-color']
  let stopOpacity: number | undefined
  if (raw.attrs.style) {
    for (const decl of raw.attrs.style.split(';')) {
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const k = decl.slice(0, idx).trim()
      const v = decl.slice(idx + 1).trim()
      if (k === 'stop-color' && !stopColor) stopColor = v
      if (k === 'stop-opacity' && stopOpacity === undefined) stopOpacity = Number.parseFloat(v)
    }
  }
  if (raw.attrs['stop-opacity']) stopOpacity = Number.parseFloat(raw.attrs['stop-opacity']!)
  const color = parseColor(stopColor ?? 'black')
  if (stopOpacity != null && Number.isFinite(stopOpacity)) {
    // Clamp stopOpacity to [0,1] before scaling so values like "1.5" don't push alpha past 255.
    const op = Math.max(0, Math.min(1, stopOpacity))
    color.a = Math.max(0, Math.min(255, Math.round(color.a * op)))
  }
  return { offset, color }
}

/**
 * Order gradient stops by offset and clamp each offset to be ≥ the previous
 * one. Per SVG spec, out-of-order offsets are coerced into monotonic order
 * (so a stop with offset 0.4 after a stop with offset 0.7 becomes 0.7).
 */
function normaliseGradientStops(stops: SVGGradientStop[]): SVGGradientStop[] {
  const sorted = stops.slice().sort((a, b) => a.offset - b.offset)
  let lastOffset = 0
  for (const s of sorted) {
    if (s.offset < lastOffset) s.offset = lastOffset
    else lastOffset = s.offset
  }
  return sorted
}

/**
 * Intermediate gradient representation that records which fields were
 * explicitly set on the source element. Required to implement
 * `xlink:href` inheritance (resolveGradientHrefs) per SVG spec — fields
 * that weren't set on the child inherit from the referenced parent.
 */
interface RawGradient {
  gradient: SVGGradient
  hasOwnStops: boolean
  setKeys: Set<string>
  href: string | null
}

function parseGradient(raw: RawElement): RawGradient | null {
  const id = raw.attrs.id
  if (!id) return null
  const setKeys = new Set<string>()
  for (const k of Object.keys(raw.attrs)) setKeys.add(k)

  const units = raw.attrs.gradientUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox'
  const spreadRaw = raw.attrs.spreadMethod
  const spreadMethod = spreadRaw === 'reflect' || spreadRaw === 'repeat' ? spreadRaw : 'pad'
  const transform = raw.attrs.gradientTransform ? parseTransform(raw.attrs.gradientTransform) : undefined
  const stops: SVGGradientStop[] = normaliseGradientStops(
    raw.children
      .filter((c): c is RawElement => c.tag === 'stop')
      .map(parseGradientStop),
  )
  const hrefRaw = raw.attrs.href ?? raw.attrs['xlink:href']
  const href = hrefRaw && hrefRaw.startsWith('#') ? hrefRaw.slice(1) : null

  if (raw.tag === 'linearGradient') {
    const grad: SVGLinearGradient = {
      tag: 'linearGradient',
      id,
      x1: parseLengthPercent(raw.attrs.x1, 1, 0),
      y1: parseLengthPercent(raw.attrs.y1, 1, 0),
      x2: parseLengthPercent(raw.attrs.x2, 1, 1),
      y2: parseLengthPercent(raw.attrs.y2, 1, 0),
      units,
      spreadMethod,
      stops,
      gradientTransform: transform,
      attrs: raw.attrs,
    }
    return { gradient: grad, hasOwnStops: stops.length > 0, setKeys, href }
  }
  if (raw.tag === 'radialGradient') {
    const cx = parseLengthPercent(raw.attrs.cx, 1, 0.5)
    const cy = parseLengthPercent(raw.attrs.cy, 1, 0.5)
    const grad: SVGRadialGradient = {
      tag: 'radialGradient',
      id,
      cx,
      cy,
      r: parseLengthPercent(raw.attrs.r, 1, 0.5),
      fx: raw.attrs.fx != null ? parseLengthPercent(raw.attrs.fx, 1, cx) : cx,
      fy: raw.attrs.fy != null ? parseLengthPercent(raw.attrs.fy, 1, cy) : cy,
      units,
      spreadMethod,
      stops,
      gradientTransform: transform,
      attrs: raw.attrs,
    }
    return { gradient: grad, hasOwnStops: stops.length > 0, setKeys, href }
  }
  return null
}

/**
 * Resolve `xlink:href` chains: a gradient that links to another gradient
 * inherits the parent's stops (if it has none of its own) and any
 * geometry attribute (x1/y1/x2/y2 / cx/cy/r/fx/fy / units / spreadMethod /
 * gradientTransform) that wasn't explicitly set on the child.
 *
 * Cycles are guarded with a visited set; a self-loop short-circuits.
 */
function resolveGradientHrefs(raws: Map<string, RawGradient>): Map<string, SVGGradient> {
  const out = new Map<string, SVGGradient>()
  const resolved = new Map<string, SVGGradient>()

  const resolve = (id: string, seen: Set<string>): SVGGradient | null => {
    const cached = resolved.get(id)
    if (cached) return cached
    if (seen.has(id)) return null
    seen.add(id)
    const r = raws.get(id)
    if (!r) return null
    if (!r.href) {
      resolved.set(id, r.gradient)
      return r.gradient
    }
    const parent = resolve(r.href, seen)
    if (!parent || parent.tag !== r.gradient.tag) {
      resolved.set(id, r.gradient)
      return r.gradient
    }
    // Inherit fields not explicitly set on `r`.
    const merged = inheritGradient(r, parent)
    resolved.set(id, merged)
    return merged
  }

  for (const id of raws.keys()) {
    const g = resolve(id, new Set())
    if (g) out.set(id, g)
  }
  return out
}

function inheritGradient(child: RawGradient, parent: SVGGradient): SVGGradient {
  const c = child.gradient
  const stops = child.hasOwnStops ? c.stops : parent.stops
  const has = (k: string) => child.setKeys.has(k)
  const baseFields = {
    units: has('gradientUnits') ? c.units : parent.units,
    spreadMethod: has('spreadMethod') ? c.spreadMethod : parent.spreadMethod,
    gradientTransform: has('gradientTransform') ? c.gradientTransform : parent.gradientTransform,
  }
  if (c.tag === 'linearGradient' && parent.tag === 'linearGradient') {
    return {
      ...c,
      ...baseFields,
      x1: has('x1') ? c.x1 : parent.x1,
      y1: has('y1') ? c.y1 : parent.y1,
      x2: has('x2') ? c.x2 : parent.x2,
      y2: has('y2') ? c.y2 : parent.y2,
      stops,
    }
  }
  if (c.tag === 'radialGradient' && parent.tag === 'radialGradient') {
    return {
      ...c,
      ...baseFields,
      cx: has('cx') ? c.cx : parent.cx,
      cy: has('cy') ? c.cy : parent.cy,
      r: has('r') ? c.r : parent.r,
      fx: has('fx') ? c.fx : (has('cx') ? c.cx : parent.fx),
      fy: has('fy') ? c.fy : (has('cy') ? c.cy : parent.fy),
      stops,
    }
  }
  return c
}

/**
 * Walk the raw tree collecting paint-server / clip / mask / id-keyed
 * definitions. The result is consumed by the renderer to resolve
 * `fill="url(#id)"`, `clip-path="url(#id)"`, `<use href="#id" />`, etc.
 */
function collectDefs(raw: RawElement, vbW: number, vbH: number): SVGDefs {
  const defs: SVGDefs = {
    gradients: new Map(),
    clipPaths: new Map(),
    masks: new Map(),
    byId: new Map(),
  }
  const rawGradients = new Map<string, RawGradient>()
  const walk = (el: RawElement): void => {
    if (el.tag === 'linearGradient' || el.tag === 'radialGradient') {
      const g = parseGradient(el)
      if (g) rawGradients.set(g.gradient.id, g)
    }
    else if (el.tag === 'clipPath') {
      const id = el.attrs.id
      if (id) {
        const units = el.attrs.clipPathUnits === 'objectBoundingBox' ? 'objectBoundingBox' : 'userSpaceOnUse'
        const cp: SVGClipPath = {
          tag: 'clipPath', id, units,
          children: el.children
            .filter((c): c is RawElement => c.tag !== '#text')
            .map(c => buildNode(c, vbW, vbH))
            .filter((c): c is SVGNode => c != null),
          attrs: el.attrs,
        }
        defs.clipPaths.set(id, cp)
      }
    }
    else if (el.tag === 'mask') {
      const id = el.attrs.id
      if (id) {
        const units = el.attrs.maskUnits === 'objectBoundingBox' ? 'objectBoundingBox' : 'userSpaceOnUse'
        const contentUnits = el.attrs.maskContentUnits === 'objectBoundingBox' ? 'objectBoundingBox' : 'userSpaceOnUse'
        const maskType = el.attrs['mask-type'] === 'alpha' ? 'alpha' : 'luminance'
        const mk: SVGMask = {
          tag: 'mask', id, units, contentUnits, maskType,
          x: el.attrs.x != null ? parseLengthPercent(el.attrs.x, vbW, 0) : undefined,
          y: el.attrs.y != null ? parseLengthPercent(el.attrs.y, vbH, 0) : undefined,
          width: el.attrs.width != null ? parseLengthPercent(el.attrs.width, vbW, vbW) : undefined,
          height: el.attrs.height != null ? parseLengthPercent(el.attrs.height, vbH, vbH) : undefined,
          children: el.children
            .filter((c): c is RawElement => c.tag !== '#text')
            .map(c => buildNode(c, vbW, vbH))
            .filter((c): c is SVGNode => c != null),
          attrs: el.attrs,
        }
        defs.masks.set(id, mk)
      }
    }
    else if (el.tag === 'symbol' && el.attrs.id) {
      // <symbol> renders only via <use href="#id"> — wrap children in a group.
      const group: SVGGroup = {
        tag: 'g',
        attrs: el.attrs,
        children: el.children
          .filter((c): c is RawElement => c.tag !== '#text')
          .map(c => buildNode(c, vbW, vbH))
          .filter((c): c is SVGNode => c != null),
      }
      defs.byId.set(el.attrs.id, group)
    }
    else if (el.attrs.id) {
      const node = buildNode(el, vbW, vbH)
      if (node) defs.byId.set(el.attrs.id, node)
    }
    for (const c of el.children) {
      if (c.tag !== '#text') walk(c as RawElement)
    }
  }
  walk(raw)
  // Resolve `xlink:href` chains for gradients (stops + geometry inheritance).
  for (const [id, g] of resolveGradientHrefs(rawGradients)) defs.gradients.set(id, g)
  return defs
}

/**
 * Parse an SVG source string into a typed element tree.
 *
 * Throws if the input doesn't contain a top-level `<svg>` element.
 */
export function parseSVG(svg: string | Uint8Array | ArrayBuffer): SVGRoot {
  // Coerce binary inputs (typical when reading from disk via `Bun.file().bytes()`).
  let src: string
  if (typeof svg === 'string') {
    src = svg
  }
  else if (svg instanceof Uint8Array) {
    src = new TextDecoder('utf-8').decode(svg)
  }
  else if (svg instanceof ArrayBuffer) {
    src = new TextDecoder('utf-8').decode(new Uint8Array(svg))
  }
  else {
    throw new TypeError('parseSVG: expected string, Uint8Array, or ArrayBuffer')
  }
  if (src.trim().length === 0) {
    throw new TypeError('parseSVG: expected a non-empty SVG source')
  }
  const raw = parseRaw(src)
  if (!raw) {
    throw new Error('parseSVG: input did not contain any XML element')
  }
  if (raw.tag !== 'svg') {
    throw new Error(`parseSVG: top-level element must be <svg>, got <${raw.tag}>`)
  }
  // Pre-pass: collect <style> stylesheets and project them onto every raw
  // element's `style=` attribute. Done as a tree walk before buildNode so
  // pickStyle's existing precedence rules apply to the cascaded values.
  const sheets = collectStylesheets(raw)
  if (sheets.length > 0) {
    const apply = (e: RawElement): void => {
      applyStylesheets(sheets, e.tag, e.attrs)
      for (const c of e.children) {
        if (c.tag !== '#text') apply(c as RawElement)
      }
    }
    apply(raw)
  }
  // Initial fallback dims (before we know viewBox/width); the SVG node
  // resolves its own from attributes.
  const result = buildNode(raw, 1000, 1000) as SVGRoot
  // Collect defs (gradients/clipPaths/masks/byId) over the full raw tree.
  const vbW = result.viewBox?.width ?? result.width
  const vbH = result.viewBox?.height ?? result.height
  result.defs = collectDefs(raw, vbW, vbH)
  return result
}

export type { SVGElementNode, SVGGroup, SVGNode, SVGRoot } from './types'
