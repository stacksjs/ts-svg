/**
 * Plugin runner. `invokePlugins` walks every plugin in order and runs its
 * visitor against the AST. `createPreset` bundles a list of plugins into
 * a single entry suitable for putting in a config.
 */

import type { BuiltinPlugin, BuiltinPluginOrPreset, PluginInfo, XastRoot } from './types'
import { visit } from './util/visit'

type PluginEntry = { name: string, fn: (..._args: any[]) => any, params?: any }
type Overrides = Record<string, any> | null

// eslint-disable-next-line pickier/no-unused-vars
export function invokePlugins(
  ast: XastRoot,
  info: PluginInfo,
  plugins: ReadonlyArray<PluginEntry>,
  overrides: Overrides,
  globalOverrides: Record<string, any>,
): void {
  // Pre-compute whether either of the per-plugin merge sources is empty so we
  // can skip the spread on the common case (no per-plugin overrides + no
  // global overrides). This kills one Object.assign-style alloc per plugin.
  const noOverrides = overrides == null
  let noGlobal = true
  for (const _ in globalOverrides) { noGlobal = false; break }
  const len = plugins.length
  for (let i = 0; i < len; i++) {
    const plugin = plugins[i]!
    const override = noOverrides ? undefined : overrides![plugin.name]
    if (override === false) continue
    let params: any
    if (noOverrides && noGlobal) {
      params = plugin.params ?? {}
    }
    else if (override === undefined) {
      params = noGlobal ? (plugin.params ?? {}) : { ...plugin.params, ...globalOverrides }
    }
    else {
      params = { ...plugin.params, ...globalOverrides, ...override }
    }
    const visitor = plugin.fn(ast, params, info)
    if (visitor != null)
      visit(ast, visitor)
  }
}

export function createPreset<T extends `preset-${string}`>(
  { name, plugins }: { name: T, plugins: ReadonlyArray<BuiltinPlugin<string, any>> },
): BuiltinPluginOrPreset<T, any> {
  return {
    name,
    isPreset: true,
    plugins: Object.freeze(plugins),
    fn: (ast: XastRoot, params: any, info: PluginInfo) => {
      const { floatPrecision, overrides } = params || {}
      const globalOverrides: Record<string, any> = {}
      if (floatPrecision != null)
        globalOverrides.floatPrecision = floatPrecision
      if (overrides) {
        const pluginNames = plugins.map(p => p.name)
        for (const pluginName of Object.keys(overrides)) {
          if (!pluginNames.includes(pluginName)) {
            console.warn(
              `You are trying to configure ${pluginName} which is not part of ${name}.\n`
              + `Try to put it before or after, for example\n\n`
              + `plugins: [\n`
              + `  {\n`
              + `    name: '${name}',\n`
              + `  },\n`
              + `  '${pluginName}'\n`
              + `]\n`,
            )
          }
        }
      }
      invokePlugins(ast, info, plugins, overrides, globalOverrides)
    },
  } as BuiltinPluginOrPreset<T, any>
}
