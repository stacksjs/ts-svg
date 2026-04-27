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

/**
 * Synchronous default config. Available immediately at import — safe for
 * `bun build --compile` and any bundler that doesn't support top-level
 * await. Use `getConfig()` if you actually need user-supplied bunfig
 * overrides (it lazy-loads on first call).
 */
export const config: SvgConfig = { ...defaultConfig }

let _configPromise: Promise<SvgConfig> | null = null

/**
 * Lazy async config loader. Resolves to the user's `svg.config.{ts,js,json}`
 * merged onto defaults. The first call kicks off the load; subsequent calls
 * reuse the promise (and therefore the same merged object).
 */
export function getConfig(): Promise<SvgConfig> {
  if (!_configPromise) {
    _configPromise = loadConfig({ name: 'svg', defaultConfig })
      .then((loaded) => {
        Object.assign(config, loaded) // mutate the singleton so cached refs see updates
        return config
      })
  }
  return _configPromise
}
