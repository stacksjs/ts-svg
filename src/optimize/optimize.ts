/**
 * Public `optimize(input, config)` API — runs the configured plugin pipeline
 * over an SVG string and returns the optimized output. Mirrors SVGO v4's
 * surface so existing config files are drop-in compatible.
 */

import type { Config, Output, PluginInfo } from './types'
import { builtinPlugins } from './builtin'
import { parseSvg } from './parser'
import { invokePlugins } from './plugins'
import { stringifySvg } from './stringifier'
import { encodeSVGDatauri } from './tools'

const pluginsMap = new Map<string, any>()
for (const plugin of builtinPlugins)
  pluginsMap.set(plugin.name, plugin)

function getPlugin(name: string): any {
  if (name === 'removeScriptElement') {
    console.warn('Warning: removeScriptElement has been renamed to removeScripts, please update your config')
    return pluginsMap.get('removeScripts')
  }
  return pluginsMap.get(name)
}

function resolvePluginConfig(plugin: unknown): { name: string, fn: any, params?: any } | null {
  if (typeof plugin === 'string') {
    const builtin = getPlugin(plugin)
    if (builtin == null)
      throw new Error(`Unknown builtin plugin "${plugin}" specified.`)
    return { name: plugin, params: {}, fn: builtin.fn }
  }
  if (typeof plugin === 'object' && plugin != null) {
    const p = plugin as { name: string, fn?: any, params?: any }
    if (p.name == null)
      throw new Error(`Plugin name must be specified`)
    let fn = p.fn
    if (fn == null) {
      const builtin = getPlugin(p.name)
      if (builtin == null)
        throw new Error(`Unknown builtin plugin "${p.name}" specified.`)
      fn = builtin.fn
    }
    return { name: p.name, params: p.params, fn }
  }
  return null
}

export function optimize(input: string, config?: Config): Output {
  if (config == null)
    config = {}
  if (typeof config !== 'object')
    throw new Error('Config should be an object')

  const maxPassCount = config.multipass ? 10 : 1
  let prevResultSize = Number.POSITIVE_INFINITY
  let output = ''
  const info: PluginInfo = { multipassCount: 0 }
  if (config.path != null)
    info.path = config.path

  for (let i = 0; i < maxPassCount; i++) {
    info.multipassCount = i
    const ast = parseSvg(input, config.path)
    const plugins = config.plugins || ['preset-default']
    if (!Array.isArray(plugins))
      throw new Error('malformed config, `plugins` property must be an array.')

    const resolved = plugins
      .filter(p => p != null)
      .map(resolvePluginConfig)
      .filter((p): p is NonNullable<typeof p> => p != null)
    if (resolved.length < plugins.length)
      console.warn('Warning: plugins list includes null or undefined elements, these will be ignored.')

    const globalOverrides: Record<string, any> = {}
    if (config.floatPrecision != null)
      globalOverrides.floatPrecision = config.floatPrecision

    invokePlugins(ast, info, resolved, null, globalOverrides)
    output = stringifySvg(ast, config.js2svg)
    if (output.length < prevResultSize) {
      input = output
      prevResultSize = output.length
    }
    else {
      break
    }
  }
  if (config.datauri)
    output = encodeSVGDatauri(output, config.datauri)
  return { data: output }
}
