/**
 * Utility helpers used across plugins. Adapted from SVGO's lib/svgo/tools.js.
 */

import type { DataUri, PathDataCommand, XastElement } from './types'
import { Buffer } from 'node:buffer'
import { attrsGroups, referencesProps } from './plugins/_collections'

export interface CleanupOutDataParams {
  noSpaceAfterFlags?: boolean
  leadingZero?: boolean
  negativeExtraSpace?: boolean
}

const regReferencesUrl = /\burl\((["'])?#(.+?)\1\)/g
const regReferencesHref = /^#(.+?)$/
const regReferencesBegin = /(\w+)\.[a-z]/i

export function encodeSVGDatauri(str: string, type?: DataUri): string {
  let prefix = 'data:image/svg+xml'
  if (!type || type === 'base64') {
    prefix += ';base64,'
    return prefix + Buffer.from(str).toString('base64')
  }
  if (type === 'enc')
    return `${prefix},${encodeURIComponent(str)}`
  if (type === 'unenc')
    return `${prefix},${str}`
  return str
}

export function decodeSVGDatauri(str: string): string {
  const regexp = /data:image\/svg\+xml(;charset=[^;,]*)?(;base64)?,(.*)/
  const match = regexp.exec(str)
  if (!match)
    return str
  const data = match[3]!
  if (match[2])
    return Buffer.from(data, 'base64').toString('utf8')
  if (data.charAt(0) === '%')
    return decodeURIComponent(data)
  if (data.charAt(0) === '<')
    return data
  return str
}

/**
 * Compress an array of numbers into the shortest valid SVG path-arg string.
 *
 * Examples:
 *   [0, -1, .5, .5] → "0-1 .5.5"
 */
export function cleanupOutData(
  data: ReadonlyArray<number>,
  params: CleanupOutDataParams,
  command?: PathDataCommand,
): string {
  let str = ''
  let delimiter: string
  let prev = 0

  for (let i = 0; i < data.length; i++) {
    const item = data[i]!
    delimiter = ' '
    if (i === 0)
      delimiter = ''

    if (params.noSpaceAfterFlags && (command === 'A' || command === 'a')) {
      const pos = i % 7
      if (pos === 4 || pos === 5)
        delimiter = ''
    }

    const itemStr = params.leadingZero ? removeLeadingZero(item) : item.toString()

    if (
      params.negativeExtraSpace
      && delimiter !== ''
      && (item < 0 || (itemStr.charAt(0) === '.' && prev % 1 !== 0))
    ) {
      delimiter = ''
    }
    prev = item
    str += delimiter + itemStr
  }
  return str
}

/**
 * Strip leading zero on values in (-1, 1).
 *   0.5 → .5
 *  -0.5 → -.5
 *
 * Hot path: called once per path-arg per stringify pass. Avoid `.startsWith`
 * (which allocates an iterator) and skip `.slice` for integers / |v| ≥ 1
 * where there's no leading zero to strip.
 */
export function removeLeadingZero(value: number): string {
  // Branchless filter for the only case that matters: -1 < v < 1 (excluding 0).
  if (value === 0 || value <= -1 || value >= 1) return value.toString()
  const s = value.toString()
  // Positive: "0.x..." → ".x..."
  if (s.charCodeAt(0) === 48 /* 0 */ && s.charCodeAt(1) === 46 /* . */) return s.slice(1)
  // Negative: "-0.x..." → "-.x..."
  if (s.charCodeAt(0) === 45 /* - */ && s.charCodeAt(1) === 48 && s.charCodeAt(2) === 46) {
    return `-${s.slice(2)}`
  }
  return s
}

const hasScriptsEventAttrs: ReadonlyArray<string> = [
  ...(attrsGroups.animationEvent ?? new Set()),
  ...(attrsGroups.documentEvent ?? new Set()),
  ...(attrsGroups.documentElementEvent ?? new Set()),
  ...(attrsGroups.globalEvent ?? new Set()),
  ...(attrsGroups.graphicalEvent ?? new Set()),
]

export function hasScripts(node: XastElement): boolean {
  if (node.name === 'script' && node.children.length !== 0)
    return true
  if (node.name === 'a') {
    const hasJsLinks = Object.entries(node.attributes).some(([attrKey, attrValue]) => {
      return (attrKey === 'href' || attrKey.endsWith(':href'))
        && attrValue != null
        && attrValue.trimStart().startsWith('javascript:')
    })
    if (hasJsLinks)
      return true
  }
  return hasScriptsEventAttrs.some(attr => node.attributes[attr] != null)
}

export function includesUrlReference(body: string): boolean {
  return new RegExp(regReferencesUrl).test(body)
}

export function includesCssVarReference(body: string): boolean {
  return /var\s*\(\s*--/.test(body)
}

export function findReferences(attribute: string, value: string): string[] {
  const results: string[] = []
  if (referencesProps.has(attribute)) {
    const matches = value.matchAll(regReferencesUrl)
    for (const m of matches)
      results.push(m[2]!)
  }
  if (attribute === 'href' || attribute.endsWith(':href')) {
    const m = regReferencesHref.exec(value)
    if (m != null)
      results.push(m[1]!)
  }
  if (attribute === 'begin') {
    const m = regReferencesBegin.exec(value)
    if (m != null)
      results.push(m[1]!)
  }
  return results.map(body => decodeURI(body))
}

export function toFixed(num: number, precision: number): number {
  const pow = 10 ** precision
  return Math.round(num * pow) / pow
}
