/**
 * Type definitions for the optimizer subsystem.
 *
 * The xast tree is generic XML — distinct from the render-oriented
 * tree in `src/types.ts`. Layout based on the SVGO project (MIT).
 */

export interface XastDoctype {
  type: 'doctype'
  name: string
  data: { doctype: string }
}

export interface XastInstruction {
  type: 'instruction'
  name: string
  value: string
}

export interface XastComment {
  type: 'comment'
  value: string
}

export interface XastCdata {
  type: 'cdata'
  value: string
}

export interface XastText {
  type: 'text'
  value: string
}

export interface XastElement {
  type: 'element'
  name: string
  attributes: Record<string, string>
  children: XastChild[]
}

export type XastChild =
  | XastDoctype
  | XastInstruction
  | XastComment
  | XastCdata
  | XastText
  | XastElement

export interface XastRoot {
  type: 'root'
  children: XastChild[]
}

export type XastParent = XastRoot | XastElement
export type XastNode = XastRoot | XastChild

export interface StringifyOptions {
  doctypeStart?: string
  doctypeEnd?: string
  procInstStart?: string
  procInstEnd?: string
  tagOpenStart?: string
  tagOpenEnd?: string
  tagCloseStart?: string
  tagCloseEnd?: string
  tagShortStart?: string
  tagShortEnd?: string
  attrStart?: string
  attrEnd?: string
  commentStart?: string
  commentEnd?: string
  cdataStart?: string
  cdataEnd?: string
  textStart?: string
  textEnd?: string
  indent?: number | string
  regEntities?: RegExp
  regValEntities?: RegExp
  encodeEntity?: (char: string) => string
  pretty?: boolean
  useShortTags?: boolean
  eol?: 'lf' | 'crlf'
  finalNewline?: boolean
}

// eslint-disable-next-line pickier/no-unused-vars
export interface VisitorNode<Node> {
  // eslint-disable-next-line pickier/no-unused-vars
  enter?: (node: Node, parentNode: XastParent) => void | symbol
  // eslint-disable-next-line pickier/no-unused-vars
  exit?: (node: Node, parentNode: XastParent) => void
}

export interface VisitorRoot {
  // eslint-disable-next-line pickier/no-unused-vars
  enter?: (node: XastRoot, parentNode: null) => void
  // eslint-disable-next-line pickier/no-unused-vars
  exit?: (node: XastRoot, parentNode: null) => void
}

export interface Visitor {
  doctype?: VisitorNode<XastDoctype>
  instruction?: VisitorNode<XastInstruction>
  comment?: VisitorNode<XastComment>
  cdata?: VisitorNode<XastCdata>
  text?: VisitorNode<XastText>
  element?: VisitorNode<XastElement>
  root?: VisitorRoot
}

export interface PluginInfo {
  path?: string
  multipassCount: number
}

// eslint-disable-next-line pickier/no-unused-vars
export type Plugin<P = null> = (root: XastRoot, params: P, info: PluginInfo) => Visitor | null | void

export type Specificity = readonly [number, number, number]

export interface StylesheetDeclaration {
  name: string
  value: string
  important: boolean
}

export interface StylesheetRule {
  dynamic: boolean
  selector: string
  specificity: Specificity
  declarations: StylesheetDeclaration[]
}

export interface Stylesheet {
  rules: StylesheetRule[]
  parents: Map<XastElement, XastParent>
}

export interface StaticStyle {
  type: 'static'
  inherited: boolean
  value: string
}

export interface DynamicStyle {
  type: 'dynamic'
  inherited: boolean
}

export type ComputedStyles = Record<string, StaticStyle | DynamicStyle>

export type PathDataCommand =
  | 'M' | 'm' | 'Z' | 'z' | 'L' | 'l' | 'H' | 'h' | 'V' | 'v'
  | 'C' | 'c' | 'S' | 's' | 'Q' | 'q' | 'T' | 't' | 'A' | 'a'

export interface PathDataItem {
  command: PathDataCommand
  args: number[]
}

export type DataUri = 'base64' | 'enc' | 'unenc'

export interface BuiltinPlugin<Name extends string, Params> {
  name: Name
  description?: string
  fn: Plugin<Params>
}

export interface BuiltinPresetExtras {
  isPreset: true
  plugins: ReadonlyArray<BuiltinPlugin<string, any>>
}

export type BuiltinPluginOrPreset<Name extends string, Params> =
  & BuiltinPlugin<Name, Params>
  & (BuiltinPresetExtras | { isPreset?: undefined, plugins?: undefined })

export interface CustomPlugin<T = any> {
  name: string
  fn: Plugin<T>
  params?: T
}

export type PluginConfig =
  | string
  | { name: string, params?: any }
  | CustomPlugin

export interface Config {
  /** Used by some plugins (e.g. prefixIds). */
  path?: string
  /** Run plugins multiple times until output stabilises (max 10 passes). */
  multipass?: boolean
  /** Default decimal precision for numeric output across plugins. */
  floatPrecision?: number
  /** Plugin list. Defaults to `['preset-default']`. */
  plugins?: PluginConfig[]
  /** Stringifier options. */
  js2svg?: StringifyOptions
  /** Output as a Data URI string. */
  datauri?: DataUri
}

export interface Output {
  data: string
}
