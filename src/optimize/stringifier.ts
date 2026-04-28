/**
 * xast → SVG string. Default output matches SVGO byte-for-byte; supports
 * pretty-print, configurable delimiters, custom entity encoding.
 */

import type { StringifyOptions, XastCdata, XastComment, XastDoctype, XastElement, XastInstruction, XastParent, XastRoot, XastText } from './types'
import { textElems } from './plugins/_collections'

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '\'': '&apos;',
  '"': '&quot;',
  '>': '&gt;',
  '<': '&lt;',
}

function defaultEncodeEntity(char: string): string {
  return ENTITIES[char]!
}

interface ResolvedOptions {
  doctypeStart: string
  doctypeEnd: string
  procInstStart: string
  procInstEnd: string
  tagOpenStart: string
  tagOpenEnd: string
  tagCloseStart: string
  tagCloseEnd: string
  tagShortStart: string
  tagShortEnd: string
  attrStart: string
  attrEnd: string
  commentStart: string
  commentEnd: string
  cdataStart: string
  cdataEnd: string
  textStart: string
  textEnd: string
  indent: number | string
  regEntities: RegExp
  regValEntities: RegExp
  encodeEntity: (char: string) => string
  pretty: boolean
  useShortTags: boolean
  eol: 'lf' | 'crlf'
  finalNewline: boolean
}

const DEFAULTS: ResolvedOptions = {
  doctypeStart: '<!DOCTYPE',
  doctypeEnd: '>',
  procInstStart: '<?',
  procInstEnd: '?>',
  tagOpenStart: '<',
  tagOpenEnd: '>',
  tagCloseStart: '</',
  tagCloseEnd: '>',
  tagShortStart: '<',
  tagShortEnd: '/>',
  attrStart: '="',
  attrEnd: '"',
  commentStart: '<!--',
  commentEnd: '-->',
  cdataStart: '<![CDATA[',
  cdataEnd: ']]>',
  textStart: '',
  textEnd: '',
  indent: 4,
  regEntities: /[&'"<>]/g,
  regValEntities: /[&"<>]/g,
  encodeEntity: defaultEncodeEntity,
  pretty: false,
  useShortTags: true,
  eol: 'lf',
  finalNewline: false,
}

interface State {
  indent: string
  textContext: XastElement | null
  indentLevel: number
}

export function stringifySvg(data: XastRoot, userOptions: StringifyOptions = {}): string {
  const config: ResolvedOptions = { ...DEFAULTS, ...(userOptions as Partial<ResolvedOptions>) }
  const indent = config.indent
  let newIndent = '    '
  if (typeof indent === 'number' && !Number.isNaN(indent))
    newIndent = indent < 0 ? '\t' : ' '.repeat(indent)
  else if (typeof indent === 'string')
    newIndent = indent

  const state: State = {
    indent: newIndent,
    textContext: null,
    indentLevel: 0,
  }

  const eol = config.eol === 'crlf' ? '\r\n' : '\n'
  if (config.pretty) {
    config.doctypeEnd += eol
    config.procInstEnd += eol
    config.commentEnd += eol
    config.cdataEnd += eol
    config.tagShortEnd += eol
    config.tagOpenEnd += eol
    config.tagCloseEnd += eol
    config.textEnd += eol
  }

  let svg = stringifyNode(data, config, state)
  if (config.finalNewline && svg.length > 0 && !svg.endsWith('\n'))
    svg += eol
  return svg
}

function stringifyNode(data: XastParent, config: ResolvedOptions, state: State): string {
  let out = ''
  state.indentLevel++
  for (const item of data.children) {
    switch (item.type) {
      case 'element':
        out += stringifyElement(item, config, state)
        break
      case 'text':
        out += stringifyText(item, config, state)
        break
      case 'doctype':
        out += stringifyDoctype(item, config)
        break
      case 'instruction':
        out += stringifyInstruction(item, config)
        break
      case 'comment':
        out += stringifyComment(item, config)
        break
      case 'cdata':
        out += stringifyCdata(item, config, state)
        break
    }
  }
  state.indentLevel--
  return out
}

function createIndent(config: ResolvedOptions, state: State): string {
  if (config.pretty && state.textContext == null)
    return state.indent.repeat(state.indentLevel - 1)
  return ''
}

function stringifyDoctype(node: XastDoctype, config: ResolvedOptions): string {
  return config.doctypeStart + node.data.doctype + config.doctypeEnd
}

function stringifyInstruction(node: XastInstruction, config: ResolvedOptions): string {
  return `${config.procInstStart + node.name} ${node.value}${config.procInstEnd}`
}

function stringifyComment(node: XastComment, config: ResolvedOptions): string {
  return config.commentStart + node.value + config.commentEnd
}

function stringifyCdata(node: XastCdata, config: ResolvedOptions, state: State): string {
  return createIndent(config, state) + config.cdataStart + node.value + config.cdataEnd
}

function stringifyElement(node: XastElement, config: ResolvedOptions, state: State): string {
  if (node.children.length === 0) {
    if (config.useShortTags) {
      return (
        createIndent(config, state)
        + config.tagShortStart
        + node.name
        + stringifyAttributes(node, config)
        + config.tagShortEnd
      )
    }
    return (
      createIndent(config, state)
      + config.tagShortStart
      + node.name
      + stringifyAttributes(node, config)
      + config.tagOpenEnd
      + config.tagCloseStart
      + node.name
      + config.tagCloseEnd
    )
  }

  let tagOpenStart = config.tagOpenStart
  let tagOpenEnd = config.tagOpenEnd
  let tagCloseStart = config.tagCloseStart
  let tagCloseEnd = config.tagCloseEnd
  let openIndent = createIndent(config, state)
  let closeIndent = createIndent(config, state)

  if (state.textContext) {
    tagOpenStart = DEFAULTS.tagOpenStart
    tagOpenEnd = DEFAULTS.tagOpenEnd
    tagCloseStart = DEFAULTS.tagCloseStart
    tagCloseEnd = DEFAULTS.tagCloseEnd
    openIndent = ''
  }
  else if (textElems.has(node.name)) {
    tagOpenEnd = DEFAULTS.tagOpenEnd
    tagCloseStart = DEFAULTS.tagCloseStart
    closeIndent = ''
    state.textContext = node
  }

  const children = stringifyNode(node, config, state)

  if (state.textContext === node)
    state.textContext = null

  return (
    openIndent
    + tagOpenStart
    + node.name
    + stringifyAttributes(node, config)
    + tagOpenEnd
    + children
    + closeIndent
    + tagCloseStart
    + node.name
    + tagCloseEnd
  )
}

// Default attribute-value entity set — `& " < >`. Anything else can use the
// generic .replace() path. Hot path uses indexOf checks so the regex never
// runs for the overwhelming majority of values that contain none of these.
function encodeValueDefault(s: string): string {
  if (s.indexOf('&') < 0 && s.indexOf('"') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0)
    return s
  return s.replace(DEFAULTS.regValEntities, defaultEncodeEntity)
}

function encodeTextDefault(s: string): string {
  if (s.indexOf('&') < 0 && s.indexOf('\'') < 0 && s.indexOf('"') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0)
    return s
  return s.replace(DEFAULTS.regEntities, defaultEncodeEntity)
}

function stringifyAttributes(node: XastElement, config: ResolvedOptions): string {
  let attrs = ''
  const isDefault = config.encodeEntity === defaultEncodeEntity && config.regValEntities === DEFAULTS.regValEntities
  const attributes = node.attributes
  for (const name in attributes) {
    const value = attributes[name]
    attrs += ` ${name}`
    if (value !== undefined) {
      const sval = typeof value === 'string' ? value : String(value)
      const encoded = isDefault ? encodeValueDefault(sval) : sval.replace(config.regValEntities, config.encodeEntity)
      attrs += config.attrStart + encoded + config.attrEnd
    }
  }
  return attrs
}

function stringifyText(node: XastText, config: ResolvedOptions, state: State): string {
  const isDefault = config.encodeEntity === defaultEncodeEntity && config.regEntities === DEFAULTS.regEntities
  const encoded = isDefault ? encodeTextDefault(node.value) : node.value.replace(config.regEntities, config.encodeEntity)
  return (
    createIndent(config, state)
    + config.textStart
    + encoded
    + (state.textContext ? '' : config.textEnd)
  )
}
