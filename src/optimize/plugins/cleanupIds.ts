/** Drop unreferenced ids and minify the rest to short alphabetic names. (Adapted from SVGO, MIT.) */

import type { Plugin, XastElement } from '../types'
import { findReferences, hasScripts } from '../tools'
import { visitSkip } from '../util/visit'

export interface CleanupIdsParams {
  remove?: boolean
  minify?: boolean
  preserve?: string[]
  preservePrefixes?: string[]
  force?: boolean
}

export const name = 'cleanupIds'
export const description = 'removes unused IDs and minifies used'

const generateIdChars = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
]
const maxIdIndex = generateIdChars.length - 1

function hasStringPrefix(s: string, prefixes: ReadonlyArray<string>): boolean {
  for (const p of prefixes) {
    if (s.startsWith(p))
      return true
  }
  return false
}

function generateId(currentId: number[] | null): number[] {
  if (currentId == null)
    return [0]
  currentId[currentId.length - 1]! += 1
  for (let i = currentId.length - 1; i > 0; i--) {
    if (currentId[i]! > maxIdIndex) {
      currentId[i] = 0
      if (currentId[i - 1] !== undefined)
        currentId[i - 1]!++
    }
  }
  if (currentId[0]! > maxIdIndex) {
    currentId[0] = 0
    currentId.unshift(0)
  }
  return currentId
}

function getIdString(arr: ReadonlyArray<number>): string {
  return arr.map(i => generateIdChars[i]).join('')
}

export const fn: Plugin<CleanupIdsParams> = (_root, params) => {
  const {
    remove = true,
    minify = true,
    preserve = [],
    preservePrefixes = [],
    force = false,
  } = params || {}
  const preserveIds = new Set(Array.isArray(preserve) ? preserve : preserve ? [preserve] : [])
  const preserveIdPrefixes = Array.isArray(preservePrefixes)
    ? preservePrefixes
    : preservePrefixes ? [preservePrefixes] : []

  const nodeById = new Map<string, XastElement>()
  const referencesById = new Map<string, Array<{ element: XastElement, name: string }>>()
  let deoptimized = false

  return {
    element: {
      enter: (node) => {
        if (!force) {
          if ((node.name === 'style' && node.children.length !== 0) || hasScripts(node)) {
            deoptimized = true
            return
          }
          if (node.name === 'svg') {
            let hasDefsOnly = true
            for (const child of node.children) {
              if (child.type !== 'element' || child.name !== 'defs') {
                hasDefsOnly = false
                break
              }
            }
            if (hasDefsOnly)
              return visitSkip
          }
        }

        for (const [n, value] of Object.entries(node.attributes)) {
          if (n === 'id') {
            const id = value
            if (nodeById.has(id))
              delete node.attributes.id
            else
              nodeById.set(id, node)
          }
          else {
            const ids = findReferences(n, value)
            for (const id of ids) {
              let refs = referencesById.get(id)
              if (refs == null) {
                refs = []
                referencesById.set(id, refs)
              }
              refs.push({ element: node, name: n })
            }
          }
        }
      },
    },
    root: {
      exit: () => {
        if (deoptimized)
          return
        const isIdPreserved = (id: string): boolean => preserveIds.has(id) || hasStringPrefix(id, preserveIdPrefixes)
        let currentId: number[] | null = null
        for (const [id, refs] of referencesById) {
          const node = nodeById.get(id)
          if (node != null) {
            if (minify && !isIdPreserved(id)) {
              let currentIdString: string
              do {
                currentId = generateId(currentId)
                currentIdString = getIdString(currentId)
              } while (
                isIdPreserved(currentIdString)
                || (referencesById.has(currentIdString) && nodeById.get(currentIdString) == null)
              )
              node.attributes.id = currentIdString
              for (const { element, name } of refs) {
                const value = element.attributes[name]!
                if (value.includes('#')) {
                  element.attributes[name]
                    = value
                      .replace(`#${encodeURI(id)}`, `#${currentIdString}`)
                      .replace(`#${id}`, `#${currentIdString}`)
                }
                else {
                  element.attributes[name] = value.replace(`${id}.`, `${currentIdString}.`)
                }
              }
            }
            nodeById.delete(id)
          }
        }
        if (remove) {
          for (const [id, node] of nodeById) {
            if (!isIdPreserved(id))
              delete node.attributes.id
          }
        }
      },
    },
  }
}
