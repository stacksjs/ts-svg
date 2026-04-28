/** Registry of every built-in optimizer plugin (and the preset). */

import * as addAttributesToSVGElement from './plugins/addAttributesToSVGElement'
import * as addClassesToSVGElement from './plugins/addClassesToSVGElement'
import * as cleanupAttrs from './plugins/cleanupAttrs'
import * as cleanupEnableBackground from './plugins/cleanupEnableBackground'
import * as cleanupIds from './plugins/cleanupIds'
import * as cleanupListOfValues from './plugins/cleanupListOfValues'
import * as cleanupNumericValues from './plugins/cleanupNumericValues'
import * as collapseGroups from './plugins/collapseGroups'
import * as convertColors from './plugins/convertColors'
import * as convertEllipseToCircle from './plugins/convertEllipseToCircle'
import * as convertOneStopGradients from './plugins/convertOneStopGradients'
import * as convertPathData from './plugins/convertPathData'
import * as convertShapeToPath from './plugins/convertShapeToPath'
import * as convertStyleToAttrs from './plugins/convertStyleToAttrs'
import * as convertTransform from './plugins/convertTransform'
import * as inlineStyles from './plugins/inlineStyles'
import * as mergePaths from './plugins/mergePaths'
import * as mergeStyles from './plugins/mergeStyles'
import * as minifyStyles from './plugins/minifyStyles'
import * as moveElemsAttrsToGroup from './plugins/moveElemsAttrsToGroup'
import * as moveGroupAttrsToElems from './plugins/moveGroupAttrsToElems'
import * as prefixIds from './plugins/prefixIds'
import presetDefault from './plugins/preset-default'
import * as removeAttributesBySelector from './plugins/removeAttributesBySelector'
import * as removeAttrs from './plugins/removeAttrs'
import * as removeComments from './plugins/removeComments'
import * as removeDeprecatedAttrs from './plugins/removeDeprecatedAttrs'
import * as removeDesc from './plugins/removeDesc'
import * as removeDimensions from './plugins/removeDimensions'
import * as removeDoctype from './plugins/removeDoctype'
import * as removeEditorsNSData from './plugins/removeEditorsNSData'
import * as removeElementsByAttr from './plugins/removeElementsByAttr'
import * as removeEmptyAttrs from './plugins/removeEmptyAttrs'
import * as removeEmptyContainers from './plugins/removeEmptyContainers'
import * as removeEmptyText from './plugins/removeEmptyText'
import * as removeHiddenElems from './plugins/removeHiddenElems'
import * as removeMetadata from './plugins/removeMetadata'
import * as removeNonInheritableGroupAttrs from './plugins/removeNonInheritableGroupAttrs'
import * as removeOffCanvasPaths from './plugins/removeOffCanvasPaths'
import * as removeRasterImages from './plugins/removeRasterImages'
import * as removeScripts from './plugins/removeScripts'
import * as removeStyleElement from './plugins/removeStyleElement'
import * as removeTitle from './plugins/removeTitle'
import * as removeUnknownsAndDefaults from './plugins/removeUnknownsAndDefaults'
import * as removeUnusedNS from './plugins/removeUnusedNS'
import * as removeUselessDefs from './plugins/removeUselessDefs'
import * as removeUselessStrokeAndFill from './plugins/removeUselessStrokeAndFill'
import * as removeViewBox from './plugins/removeViewBox'
import * as removeXlink from './plugins/removeXlink'
import * as removeXMLNS from './plugins/removeXMLNS'
import * as removeXMLProcInst from './plugins/removeXMLProcInst'
import * as reusePaths from './plugins/reusePaths'
import * as sortAttrs from './plugins/sortAttrs'
import * as sortDefsChildren from './plugins/sortDefsChildren'

export const builtinPlugins: ReadonlyArray<{ name: string, fn: any, description?: string, isPreset?: true, plugins?: ReadonlyArray<unknown> }> = Object.freeze([
  presetDefault,
  addAttributesToSVGElement,
  addClassesToSVGElement,
  cleanupAttrs,
  cleanupEnableBackground,
  cleanupIds,
  cleanupListOfValues,
  cleanupNumericValues,
  collapseGroups,
  convertColors,
  convertEllipseToCircle,
  convertOneStopGradients,
  convertPathData,
  convertShapeToPath,
  convertStyleToAttrs,
  convertTransform,
  inlineStyles,
  mergePaths,
  mergeStyles,
  minifyStyles,
  moveElemsAttrsToGroup,
  moveGroupAttrsToElems,
  prefixIds,
  removeAttributesBySelector,
  removeAttrs,
  removeComments,
  removeDeprecatedAttrs,
  removeDesc,
  removeDimensions,
  removeDoctype,
  removeEditorsNSData,
  removeElementsByAttr,
  removeEmptyAttrs,
  removeEmptyContainers,
  removeEmptyText,
  removeHiddenElems,
  removeMetadata,
  removeNonInheritableGroupAttrs,
  removeOffCanvasPaths,
  removeRasterImages,
  removeScripts,
  removeStyleElement,
  removeTitle,
  removeUnknownsAndDefaults,
  removeUnusedNS,
  removeUselessDefs,
  removeUselessStrokeAndFill,
  removeViewBox,
  removeXlink,
  removeXMLNS,
  removeXMLProcInst,
  reusePaths,
  sortAttrs,
  sortDefsChildren,
])
