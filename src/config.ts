/**
 * User-facing configuration loaded via bunfig.
 *
 * On import, bunfig looks for `svg.config.ts` (or `.js` / `.json`) in the
 * consumer's project root and merges it onto `defaultConfig`. Anything
 * absent there is left at its default.
 */

import { loadConfig } from 'bunfig'

export interface SvgConfig {
  /** Emit informational warnings to `console.warn` (e.g. unknown elements). */
  verbose: boolean
  /** Default Bezier flattening tolerance in user units (pixels). */
  tolerance: number
  /** Default background colour applied when none is passed to `rasterize`. */
  background: string
  /** Default `currentColor` resolution (used when `fill="currentColor"` etc.). */
  currentColor: string
  /** Maximum recursion depth for `<use>` references; prevents cycles. */
  maxUseDepth: number
}

/** Backwards-compatible alias. */
export type SVGConfig = SvgConfig
export type SVGOptions = Partial<SvgConfig>

export const defaultConfig: SvgConfig = {
  verbose: false,
  tolerance: 0.25,
  background: 'transparent',
  currentColor: 'black',
  maxUseDepth: 16,
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: SvgConfig = await loadConfig({
  name: 'svg',
  defaultConfig,
})
