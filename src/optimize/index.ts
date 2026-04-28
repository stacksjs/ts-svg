/**
 * SVG optimizer subsystem — drop-in compatible with SVGO v4.
 *
 * Public surface:
 *   - `optimize(input, config?)` — string → optimized SVG string
 *   - `parseSvg`, `stringifySvg` — direct AST round-trip
 *   - `builtinPlugins` — every shipped plugin and the preset
 *   - `_collections` — element / attribute taxonomies
 */

export type { Config, Output, PathDataCommand, PathDataItem, Plugin, PluginConfig, PluginInfo, Specificity, Stylesheet, StylesheetDeclaration, StylesheetRule, Visitor, XastCdata, XastChild, XastComment, XastDoctype, XastElement, XastInstruction, XastNode, XastParent, XastRoot, XastText } from './types'

export { builtinPlugins } from './builtin'
export { optimize } from './optimize'
export { parseSvg, SvgParserError } from './parser'
export { stringifySvg } from './stringifier'

export * as _collections from './plugins/_collections'
export { collectStylesheet, computeStyle, includesAttrSelector } from './style'
export { decodeSVGDatauri, encodeSVGDatauri, findReferences, hasScripts, includesCssVarReference, includesUrlReference, removeLeadingZero, toFixed } from './tools'
export { mapNodesToParents } from './util/map-nodes-to-parents'
export { visit, visitSkip } from './util/visit'
export { detachNodeFromParent, matches, querySelector, querySelectorAll } from './xast'
