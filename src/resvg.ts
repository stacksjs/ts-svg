/**
 * Resvg-compatible class shim.
 *
 * Lets consumers swap `import { Resvg } from '@resvg/resvg-js'` for
 * `import { Resvg } from 'ts-svg'` without changing call sites.
 *
 *   const r = new Resvg(svgString, { fitTo: { mode: 'zoom', value: 4 } })
 *   const png = r.render().asPng()
 */

import type { Buffer } from 'node:buffer'
import { encodePng } from './png'
import { parseSVG } from './parser'
import { rasterize, type RenderOptions } from './render'
import type { Framebuffer } from './raster'

export interface ResvgFitTo {
  mode?: 'original' | 'width' | 'height' | 'zoom'
  value?: number
}

export interface ResvgOptions {
  /** Resize behaviour. `'zoom'` multiplies intrinsic dims; others set explicit. */
  fitTo?: ResvgFitTo
  /** Background colour (`'rgba(...)'` / `'#fff'` / `'red'` / etc). */
  background?: string
  /** Bezier flattening tolerance in user units. */
  tolerance?: number
}

export class RenderedImage {
  constructor(private readonly fb: Framebuffer) {}

  asPng(): Buffer {
    return encodePng(this.fb)
  }

  /** Raw RGBA buffer, top-to-bottom. */
  pixels(): Uint8Array {
    return this.fb.data
  }

  width(): number { return this.fb.width }
  height(): number { return this.fb.height }
}

export class Resvg {
  private renderOptions: RenderOptions

  constructor(private readonly svg: string, options: ResvgOptions = {}) {
    const fitTo = options.fitTo ?? { mode: 'original' }
    const opts: RenderOptions = {
      background: options.background,
      tolerance: options.tolerance,
    }
    if (fitTo.mode === 'zoom' && fitTo.value != null) {
      opts.scale = fitTo.value
    }
    else if (fitTo.mode === 'width' && fitTo.value != null) {
      opts.width = fitTo.value
      // height left unset — renderer maintains aspect via viewBox.
      // But we don't have intrinsic dims yet; render() will compute height.
      ;(opts as RenderOptions & { _maintainAspect?: 'width' })._maintainAspect = 'width'
    }
    else if (fitTo.mode === 'height' && fitTo.value != null) {
      opts.height = fitTo.value
      ;(opts as RenderOptions & { _maintainAspect?: 'height' })._maintainAspect = 'height'
    }
    this.renderOptions = opts
  }

  render(): RenderedImage {
    const root = parseSVG(this.svg)
    const opts = { ...this.renderOptions }

    // Resolve "fitTo: width/height" by maintaining aspect ratio from intrinsic dims.
    const aspectMode = (opts as RenderOptions & { _maintainAspect?: 'width' | 'height' })._maintainAspect
    if (aspectMode === 'width' && opts.width != null) {
      const aspect = (root.height || (root.viewBox?.height ?? 1)) / (root.width || (root.viewBox?.width ?? 1))
      opts.height = Math.round(opts.width * aspect)
    }
    else if (aspectMode === 'height' && opts.height != null) {
      const aspect = (root.width || (root.viewBox?.width ?? 1)) / (root.height || (root.viewBox?.height ?? 1))
      opts.width = Math.round(opts.height * aspect)
    }

    const fb = rasterize(root, opts)
    return new RenderedImage(fb)
  }
}
