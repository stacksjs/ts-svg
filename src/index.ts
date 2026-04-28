/**
 * ts-svg — pure-TypeScript SVG parser, rasterizer, PNG encoder, and optimizer
 * for Bun/Node.
 *
 * Public surface:
 *   - `parseSVG(svg)` — string → typed element tree
 *   - `rasterize(root, opts)` — element tree → RGBA framebuffer
 *   - `encodePng(fb)` — framebuffer → PNG bytes
 *   - `svgToPng(svg, opts)` — convenience pipeline
 *   - `Resvg` — `@resvg/resvg-js`-compatible class shim
 *   - `optimize(svg, config?)` — SVGO-compatible optimization pipeline
 *   - re-exports under `optimize/*` for direct AST work
 */

export * from './config'
export type {
  BaseNode,
  FontResolver,
  Matrix,
  ResolvedFont,
  RGBA,
  SVGCircle,
  SVGClipPath,
  SVGDefs,
  SVGElementNode,
  SVGEllipse,
  SVGGradient,
  SVGGradientStop,
  SVGGroup,
  SVGLine,
  SVGLinearGradient,
  SVGMask,
  SVGNode,
  SVGPath,
  SVGPolygon,
  SVGRadialGradient,
  SVGRect,
  SVGRoot,
  SVGText,
  SVGUse,
} from './types'

export { parseSVG } from './parser'
export type { PathCmd } from './path'
export { arcToCubics, flattenCommands, flattenCubic, flattenQuadratic, parsePath } from './path'
export type { Framebuffer, RenderOptions } from './render'
export { rasterize } from './render'
export { createFramebuffer, fillPolygons, strokePolylines } from './raster'
export { encodePng } from './png'
export { applyMatrix, IDENTITY, invertMatrix, multiply, parseTransform } from './transform'
export { BLACK, parseColor, TRANSPARENT, WHITE } from './color'
export type { ResvgFitTo, ResvgOptions } from './resvg'
export { RenderedImage, Resvg } from './resvg'

import type { Buffer } from 'node:buffer'
import { parseSVG } from './parser'
import { encodePng } from './png'
import { rasterize, type RenderOptions } from './render'

/** Parse + rasterise + encode in one call. */
export function svgToPng(svg: string, opts?: RenderOptions): Buffer {
  const root = parseSVG(svg)
  const fb = rasterize(root, opts)
  return encodePng(fb)
}

// ----- optimizer subsystem -----
export { builtinPlugins, optimize, parseSvg, stringifySvg, SvgParserError } from './optimize'
export type {
  Config as OptimizeConfig,
  Output as OptimizeOutput,
  Plugin as OptimizePlugin,
  PluginConfig as OptimizePluginConfig,
  XastChild,
  XastElement,
  XastNode,
  XastParent,
  XastRoot,
} from './optimize'
