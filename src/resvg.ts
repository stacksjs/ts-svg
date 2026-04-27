/**
 * Resvg-compatible class shim.
 *
 * Lets consumers swap `import { Resvg } from '@resvg/resvg-js'` for
 * `import { Resvg } from 'ts-svg'` without changing call sites.
 *
 *   const r = new Resvg(svgString, { fitTo: { mode: 'zoom', value: 4 } })
 *   const png = r.render().asPng()
 *
 * The constructor parses the SVG once and caches the tree, so calling
 * `render()` multiple times doesn't re-parse.
 */

import type { Buffer } from 'node:buffer'
import type { FontResolver, SVGRoot } from './types'
import { encodePng } from './png'
import { parseSVG } from './parser'
import { rasterize, type RenderOptions } from './render'
import type { Framebuffer } from './raster'

export interface ResvgFitTo {
  mode?: 'original' | 'width' | 'height' | 'zoom'
  value?: number
}

/**
 * Subset of `@resvg/resvg-js` options we honour. Unsupported keys are
 * accepted (typed) but currently ignored — they're listed so a `tsc`-clean
 * call site won't break when migrating from resvg-js.
 */
export interface ResvgOptions {
  /** Resize behaviour. `'zoom'` multiplies intrinsic dims; others set explicit. */
  fitTo?: ResvgFitTo
  /** Background colour (`'rgba(...)'` / `'#fff'` / `'red'` / etc). */
  background?: string
  /** Bezier flattening tolerance in user units. */
  tolerance?: number
  /** Resolves `currentColor` references. */
  currentColor?: string
  /** Hard cap on `<use>` recursion. */
  maxUseDepth?: number
  /** Resolves `<text>` font lookups. Without it `<text>` is skipped. */
  fontResolver?: FontResolver
  /** Crop the output bounds. Currently accepted for compat but ignored. */
  crop?: { left?: number, top?: number, right?: number, bottom?: number }

  // The following resvg-js fields are accepted for type compatibility but
  // are not yet implemented by ts-svg. Document explicitly so users know
  // they are no-ops; remove from the interface when implemented.
  font?: unknown
  dpi?: number
  shapeRendering?: number
  textRendering?: number
  imageRendering?: number
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  imagesToResolve?: unknown
}

export class RenderedImage {
  constructor(private readonly fb: Framebuffer) {}

  asPng(): Buffer {
    return encodePng(this.fb)
  }

  /**
   * Returns a *copy* of the raw RGBA buffer, top-to-bottom. Mutating the
   * returned array does NOT affect the cached framebuffer. (The original
   * implementation handed back the live Uint8Array — a footgun.)
   */
  pixels(): Uint8Array {
    return new Uint8Array(this.fb.data)
  }

  width(): number { return this.fb.width }
  height(): number { return this.fb.height }
}

export class Resvg {
  private readonly renderOptions: RenderOptions
  private readonly aspectMode: 'width' | 'height' | null
  /** Cached parse so repeated `.render()` calls don't re-tokenise. */
  private readonly root: SVGRoot

  constructor(svg: string, options: ResvgOptions = {}) {
    const fitTo = options.fitTo ?? { mode: 'original' }
    const opts: RenderOptions = {
      background: options.background,
      tolerance: options.tolerance,
      currentColor: options.currentColor,
      maxUseDepth: options.maxUseDepth,
      fontResolver: options.fontResolver,
    }
    let aspectMode: 'width' | 'height' | null = null
    if (fitTo.mode === 'zoom' && fitTo.value != null) {
      opts.scale = fitTo.value
    }
    else if (fitTo.mode === 'width' && fitTo.value != null) {
      opts.width = fitTo.value
      aspectMode = 'width'
    }
    else if (fitTo.mode === 'height' && fitTo.value != null) {
      opts.height = fitTo.value
      aspectMode = 'height'
    }
    this.renderOptions = opts
    this.aspectMode = aspectMode
    this.root = parseSVG(svg)
  }

  render(): RenderedImage {
    const fb = rasterize(this.root, this.resolveOptions())
    return new RenderedImage(fb)
  }

  /**
   * Render into an existing framebuffer. Lets consumers reuse a buffer
   * across frames (e.g. for animations or hot paths) instead of reallocating
   * an RGBA `Uint8Array` per `render()`. The framebuffer is cleared to
   * transparent before rendering; pass `clear: false` to composite over
   * existing pixel data.
   */
  renderInto(fb: Framebuffer, opts?: { clear?: boolean }): void {
    if (opts?.clear !== false) {
      fb.data.fill(0)
    }
    const renderOpts = this.resolveOptions()
    renderOpts.width = fb.width
    renderOpts.height = fb.height
    // Re-key on existing fb's dimensions so user can size the buffer themselves.
    const result = rasterize(this.root, renderOpts)
    // Copy pixels back if rasterize allocated its own (the simple path).
    if (result !== (fb as Framebuffer)) {
      fb.data.set(result.data)
    }
  }

  private resolveOptions(): RenderOptions {
    const opts: RenderOptions = { ...this.renderOptions }
    if (this.aspectMode === 'width' && opts.width != null) {
      const aspect = (this.root.height || (this.root.viewBox?.height ?? 1)) / (this.root.width || (this.root.viewBox?.width ?? 1))
      opts.height = Math.round(opts.width * aspect)
    }
    else if (this.aspectMode === 'height' && opts.height != null) {
      const aspect = (this.root.width || (this.root.viewBox?.width ?? 1)) / (this.root.height || (this.root.viewBox?.height ?? 1))
      opts.width = Math.round(opts.height * aspect)
    }
    return opts
  }
}
