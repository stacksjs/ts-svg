/**
 * Project-level configuration loader. Currently only carries a `verbose`
 * flag; kept around for forward-compatibility with `bunfig`-style configs.
 */

import { loadConfig } from 'bunfig'

export interface SVGConfig {
  verbose: boolean
}

export const defaultConfig: SVGConfig = {
  verbose: true,
}

let _config: SVGConfig | null = null

export async function getConfig(): Promise<SVGConfig> {
  if (!_config) {
    _config = await loadConfig({
      name: 'svg',
      defaultConfig,
    })
  }
  return _config
}

export const config: SVGConfig = defaultConfig
