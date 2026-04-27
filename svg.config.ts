import type { SvgConfig } from './src/config'

/**
 * Local defaults for ts-svg. bunfig auto-loads this file at module init
 * (see `src/config.ts`) and merges it on top of the library defaults.
 */
const config: Partial<SvgConfig> = {
  verbose: false,
  tolerance: 0.25,
  background: 'transparent',
  currentColor: 'black',
  maxUseDepth: 16,
}

export default config
