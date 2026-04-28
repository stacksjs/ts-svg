/** Prefix ids/classes (and references) so multiple SVGs can coexist in one DOM. (Adapted from SVGO, MIT.) */

import type { Plugin, PluginInfo, XastElement } from '../types'
import { csstree } from '@stacksjs/ts-css'
import { referencesProps } from './_collections'

// eslint-disable-next-line pickier/no-unused-vars
type PrefixGenerator = (node: XastElement, info: PluginInfo) => string

export interface PrefixIdsParams {
  prefix?: boolean | string | PrefixGenerator
  delim?: string
  prefixIds?: boolean
  prefixClassNames?: boolean
}

export const name = 'prefixIds'
export const description = 'prefix IDs'

function getBasename(path: string): string {
  const matched = /[/\\]?([^/\\]+)$/.exec(path)
  if (matched)
    return matched[1]!
  return ''
}

function escapeIdentifierName(s: string): string {
  return s.replace(/[. ]/g, '_')
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\'')))
    return s.slice(1, -1)
  return s
}

function prefixId(gen: (id: string) => string, body: string): string {
  const prefix = gen(body)
  if (body.startsWith(prefix))
    return body
  return prefix + body
}

function prefixReference(gen: (id: string) => string, reference: string): string | null {
  if (reference.startsWith('#'))
    return `#${prefixId(gen, reference.slice(1))}`
  return null
}

function generatePrefix(
  body: string,
  node: XastElement,
  info: PluginInfo,
  prefixGen: PrefixIdsParams['prefix'],
  delim: string,
  history: Map<string, string>,
): string {
  if (typeof prefixGen === 'function') {
    let prefix = history.get(body)
    if (prefix != null)
      return prefix
    prefix = prefixGen(node, info) + delim
    history.set(body, prefix)
    return prefix
  }
  if (typeof prefixGen === 'string')
    return prefixGen + delim
  if (prefixGen === false)
    return ''
  if (info.path != null && info.path.length > 0)
    return escapeIdentifierName(getBasename(info.path)) + delim
  return `prefix${delim}`
}

export const fn: Plugin<PrefixIdsParams> = (_root, params, info) => {
  const { delim = '__', prefix, prefixIds = true, prefixClassNames = true } = params || {}
  const prefixMap = new Map<string, string>()

  return {
    element: {
      enter: (node) => {
        const prefixGenerator = (id: string): string => generatePrefix(id, node, info, prefix, delim, prefixMap)

        if (node.name === 'style') {
          if (node.children.length === 0)
            return
          for (const child of node.children) {
            if (child.type !== 'text' && child.type !== 'cdata')
              continue
            const cssText = child.value
            let cssAst: csstree.CssNode
            try {
              cssAst = csstree.parse(cssText, { parseValue: true, parseCustomProperty: false })
            }
            catch {
              return
            }
            csstree.walk(cssAst, (n) => {
              if (
                (prefixIds && n.type === 'IdSelector')
                || (prefixClassNames && n.type === 'ClassSelector')
              ) {
                ;(n as any).name = prefixId(prefixGenerator, (n as any).name)
                return
              }
              if (n.type === 'Url' && (n as any).value.length > 0) {
                const prefixed = prefixReference(prefixGenerator, unquote((n as any).value))
                if (prefixed != null)
                  (n as any).value = prefixed
              }
            })
            child.value = csstree.generate(cssAst)
          }
        }

        if (prefixIds && node.attributes.id != null && node.attributes.id.length !== 0)
          node.attributes.id = prefixId(prefixGenerator, node.attributes.id)

        if (prefixClassNames && node.attributes.class != null && node.attributes.class.length !== 0) {
          node.attributes.class = node.attributes.class
            .split(/\s+/)
            .map(n => prefixId(prefixGenerator, n))
            .join(' ')
        }

        for (const n of ['href', 'xlink:href']) {
          if (node.attributes[n] != null && node.attributes[n]!.length !== 0) {
            const prefixed = prefixReference(prefixGenerator, node.attributes[n]!)
            if (prefixed != null)
              node.attributes[n] = prefixed
          }
        }

        for (const n of referencesProps) {
          if (node.attributes[n] != null && node.attributes[n]!.length !== 0) {
            node.attributes[n] = node.attributes[n]!.replace(
              /\burl\((["'])?(#.+?)\1\)/gi,
              (match, _q, url) => {
                const prefixed = prefixReference(prefixGenerator, url)
                if (prefixed == null)
                  return match
                return `url(${prefixed})`
              },
            )
          }
        }

        for (const n of ['begin', 'end']) {
          if (node.attributes[n] != null && node.attributes[n]!.length !== 0) {
            const parts = node.attributes[n]!.split(/\s*;\s+/).map((val) => {
              if (val.endsWith('.end') || val.endsWith('.start')) {
                const [id, postfix] = val.split('.')
                return `${prefixId(prefixGenerator, id!)}.${postfix}`
              }
              return val
            })
            node.attributes[n] = parts.join('; ')
          }
        }
      },
    },
  }
}
