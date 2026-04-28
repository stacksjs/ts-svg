/**
 * Fast hand-rolled XML/SVG parser → xast tree.
 *
 *  - Zero deps, single allocation per node.
 *  - Index-based scanning instead of SAX events.
 *  - Lazy line/column tracking (only on error).
 *
 * Behaviour:
 *  - Doctype / processing instructions / comments / cdata preserved.
 *  - Text nodes inside textual elements (`text`, `tspan`, `tref`,
 *    `textPath`, `title`, `desc`) keep their whitespace verbatim;
 *    elsewhere, whitespace-only text is dropped and others trimmed.
 *  - DTD entity declarations are honoured.
 */

import type { XastCdata, XastChild, XastComment, XastDoctype, XastElement, XastInstruction, XastParent, XastRoot, XastText } from './types'
import { textElems } from './plugins/_collections'

export class SvgParserError extends Error {
  reason: string
  line: number
  column: number
  source: string
  file?: string
  constructor(message: string, line: number, column: number, source: string, file?: string) {
    super(message)
    this.name = 'SvgParserError'
    this.message = `${file || '<input>'}:${line}:${column}: ${message}`
    this.reason = message
    this.line = line
    this.column = column
    this.source = source
    this.file = file
  }

  toString(): string {
    const lines = this.source.split(/\r?\n/)
    const startLine = Math.max(this.line - 3, 0)
    const endLine = Math.min(this.line + 2, lines.length)
    const lineNumberWidth = String(endLine).length
    const startColumn = Math.max(this.column - 54, 0)
    const endColumn = Math.max(this.column + 20, 80)
    const code = lines
      .slice(startLine, endLine)
      .map((line, index) => {
        const lineSlice = line.slice(startColumn, endColumn)
        let ellipsisPrefix = ''
        let ellipsisSuffix = ''
        if (startColumn !== 0)
          ellipsisPrefix = startColumn > line.length - 1 ? ' ' : '…'
        if (endColumn < line.length - 1)
          ellipsisSuffix = '…'
        const number = startLine + 1 + index
        const gutter = ` ${number.toString().padStart(lineNumberWidth)} | `
        if (number === this.line) {
          const gutterSpacing = gutter.replace(/[^|]/g, ' ')
          const lineSpacing = (
            ellipsisPrefix + line.slice(startColumn, this.column - 1)
          ).replace(/[^\t]/g, ' ')
          const spacing = gutterSpacing + lineSpacing
          return `>${gutter}${ellipsisPrefix}${lineSlice}${ellipsisSuffix}\n ${spacing}^`
        }
        return ` ${gutter}${ellipsisPrefix}${lineSlice}${ellipsisSuffix}`
      })
      .join('\n')
    return `${this.name}: ${this.message}\n\n${code}\n`
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
}

function decodeEntities(s: string, custom: Record<string, string> | null): string {
  if (s.indexOf('&') < 0)
    return s
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      if (body.charCodeAt(1) === 120 /* x */ || body.charCodeAt(1) === 88 /* X */) {
        const code = Number.parseInt(body.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    const lower = body.toLowerCase()
    if (lower in NAMED_ENTITIES)
      return NAMED_ENTITIES[lower]!
    if (custom && body in custom)
      return custom[body]!
    return whole
  })
}

const ENTITY_DECL_RE = /<!ENTITY\s+(\S+)\s+(?:'([^']+)'|"([^"]+)")\s*>/g

function locate(source: string, index: number): { line: number, column: number } {
  let line = 1
  let lastLineStart = 0
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line++
      lastLineStart = i + 1
    }
  }
  return { line, column: index - lastLineStart + 1 }
}

/**
 * Convert an SVG/XML string to an xast tree.
 */
export function parseSvg(data: string, from?: string): XastRoot {
  const root: XastRoot = { type: 'root', children: [] }
  let current: XastParent = root
  const stack: XastParent[] = [root]
  const customEntities: Record<string, string> = {}
  let hasCustomEntities = false

  const len = data.length
  let i = 0

  const fail = (message: string, idx: number): never => {
    const { line, column } = locate(data, idx)
    throw new SvgParserError(message, line, column, data, from)
  }

  const push = (node: XastChild): void => {
    current.children.push(node)
  }

  while (i < len) {
    const ch = data.charCodeAt(i)
    if (ch !== 60 /* < */) {
      // text node — read until next `<`
      const start = i
      while (i < len && data.charCodeAt(i) !== 60)
        i++
      const raw = data.slice(start, i)
      if (current.type === 'element') {
        const decoded = decodeEntities(raw, hasCustomEntities ? customEntities : null)
        if (textElems.has(current.name)) {
          const node: XastText = { type: 'text', value: decoded }
          push(node)
        }
        else {
          const trimmed = decoded.trim()
          if (trimmed.length > 0) {
            const node: XastText = { type: 'text', value: trimmed }
            push(node)
          }
        }
      }
      // text at root level is silently dropped (matches SAX behaviour for
      // pre-root whitespace; meaningful root-level text is malformed XML anyway).
      continue
    }

    // Tag of some kind starting at `<`.
    const next = data.charCodeAt(i + 1)
    if (next === 33 /* ! */) {
      // <!--, <![CDATA[, <!DOCTYPE
      if (data.startsWith('<!--', i)) {
        const end = data.indexOf('-->', i + 4)
        if (end < 0)
          fail('Unterminated comment', i)
        const value = data.slice(i + 4, end).trim()
        const node: XastComment = { type: 'comment', value }
        push(node)
        i = end + 3
        continue
      }
      if (data.startsWith('<![CDATA[', i)) {
        const end = data.indexOf(']]>', i + 9)
        if (end < 0)
          fail('Unterminated CDATA', i)
        const value = data.slice(i + 9, end)
        const node: XastCdata = { type: 'cdata', value }
        push(node)
        i = end + 3
        continue
      }
      if (data.startsWith('<!DOCTYPE', i)) {
        // doctype can contain an internal subset `[…]`
        let j = i + 9
        let inSubset = false
        while (j < len) {
          const c = data.charCodeAt(j)
          if (c === 91 /* [ */) {
            inSubset = true
          }
          else if (c === 93 /* ] */) {
            inSubset = false
          }
          else if (c === 62 /* > */ && !inSubset) {
            break
          }
          j++
        }
        if (j >= len)
          fail('Unterminated doctype', i)
        const doctype = data.slice(i + 9, j)
        const node: XastDoctype = {
          type: 'doctype',
          name: 'svg',
          data: { doctype },
        }
        push(node)
        // collect any custom entity declarations inside the internal subset
        const subsetStart = doctype.indexOf('[')
        if (subsetStart >= 0) {
          ENTITY_DECL_RE.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = ENTITY_DECL_RE.exec(doctype)) != null) {
            customEntities[m[1]!] = m[2] ?? m[3] ?? ''
            hasCustomEntities = true
          }
        }
        i = j + 1
        continue
      }
      fail('Unrecognised <! declaration', i)
    }

    if (next === 63 /* ? */) {
      // processing instruction
      const end = data.indexOf('?>', i + 2)
      if (end < 0)
        fail('Unterminated processing instruction', i)
      const inner = data.slice(i + 2, end)
      const wsIdx = inner.search(/\s/)
      const name = wsIdx < 0 ? inner : inner.slice(0, wsIdx)
      const value = wsIdx < 0 ? '' : inner.slice(wsIdx + 1)
      const node: XastInstruction = { type: 'instruction', name, value }
      push(node)
      i = end + 2
      continue
    }

    if (next === 47 /* / */) {
      // closing tag: `</name>`
      const end = data.indexOf('>', i + 2)
      if (end < 0)
        fail('Unterminated end tag', i)
      stack.pop()
      current = stack[stack.length - 1]!
      i = end + 1
      continue
    }

    // opening tag `<name … >` or `<name … />`
    const tagStart = i + 1
    let j = tagStart
    while (j < len) {
      const c = data.charCodeAt(j)
      if (c === 32 /* space */ || c === 9 || c === 10 || c === 13 || c === 47 /* / */ || c === 62 /* > */)
        break
      j++
    }
    if (j === tagStart)
      fail('Empty tag name', i)
    const name = data.slice(tagStart, j)

    // Parse attributes until we see `>` or `/>`
    const attributes: Record<string, string> = {}
    let selfClose = false
    while (j < len) {
      let c = data.charCodeAt(j)
      // skip whitespace
      while (c === 32 || c === 9 || c === 10 || c === 13) {
        j++
        if (j >= len)
          break
        c = data.charCodeAt(j)
      }
      if (j >= len)
        fail('Unterminated open tag', i)
      if (c === 62 /* > */) {
        j++
        break
      }
      if (c === 47 /* / */) {
        if (data.charCodeAt(j + 1) !== 62)
          fail('Expected `>` after `/`', j)
        selfClose = true
        j += 2
        break
      }
      // attribute name
      const attrStart = j
      while (j < len) {
        const cc = data.charCodeAt(j)
        if (cc === 61 /* = */ || cc === 32 || cc === 9 || cc === 10 || cc === 13 || cc === 47 || cc === 62)
          break
        j++
      }
      const attrName = data.slice(attrStart, j)
      // skip whitespace before `=`
      while (j < len) {
        const cc = data.charCodeAt(j)
        if (cc !== 32 && cc !== 9 && cc !== 10 && cc !== 13)
          break
        j++
      }
      if (data.charCodeAt(j) !== 61 /* = */) {
        // Boolean attribute (rare in SVG) — treat value as empty string
        attributes[attrName] = ''
        continue
      }
      j++
      // skip whitespace after `=`
      while (j < len) {
        const cc = data.charCodeAt(j)
        if (cc !== 32 && cc !== 9 && cc !== 10 && cc !== 13)
          break
        j++
      }
      const quote = data.charCodeAt(j)
      let value: string
      if (quote === 34 /* " */ || quote === 39 /* ' */) {
        const closeQuote = data.indexOf(quote === 34 ? '"' : '\'', j + 1)
        if (closeQuote < 0)
          fail('Unterminated attribute value', j)
        value = data.slice(j + 1, closeQuote)
        j = closeQuote + 1
      }
      else {
        // unquoted attribute
        const start = j
        while (j < len) {
          const cc = data.charCodeAt(j)
          if (cc === 32 || cc === 9 || cc === 10 || cc === 13 || cc === 47 || cc === 62)
            break
          j++
        }
        value = data.slice(start, j)
      }
      attributes[attrName] = decodeEntities(value, hasCustomEntities ? customEntities : null)
    }

    const element: XastElement = {
      type: 'element',
      name,
      attributes,
      children: [],
    }
    push(element)
    if (!selfClose) {
      stack.push(element)
      current = element
    }
    i = j
  }

  if (stack.length > 1) {
    // Tolerate unclosed tags rather than throwing — matches non-strict SAX
    // parser does the same in non-strict mode.
  }

  return root
}
