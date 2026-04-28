/**
 * css-select adapter for the xast tree. Cached parent map is built lazily
 * the first time `getParent` is called and reused for the entire query.
 */

import type { XastElement, XastNode, XastParent } from './types'
import { mapNodesToParents } from './util/map-nodes-to-parents'

function isTag(node: XastNode): node is XastElement {
  return node.type === 'element'
}

function getChildren(node: XastNode): XastNode[] {
  return (node as XastParent).children ?? []
}

function existsOne(test: (e: XastElement) => boolean, elems: XastNode[]): boolean {
  return elems.some(elem => isTag(elem) && (test(elem) || existsOne(test, getChildren(elem))))
}

function getAttributeValue(elem: XastElement, name: string): string | undefined {
  return elem.attributes[name]
}

function getName(elem: XastElement): string {
  return elem.name
}

function getText(node: XastNode): string {
  const children = getChildren(node)
  if (children[0] && (children[0].type === 'text' || children[0].type === 'cdata'))
    return (children[0] as { value: string }).value
  return ''
}

function hasAttrib(elem: XastElement, name: string): boolean {
  return elem.attributes[name] !== undefined
}

function findAll(test: (e: XastElement) => boolean, elems: XastNode[]): XastElement[] {
  const result: XastElement[] = []
  for (const elem of elems) {
    if (isTag(elem)) {
      if (test(elem))
        result.push(elem)
      result.push(...findAll(test, getChildren(elem)))
    }
  }
  return result
}

function findOne(test: (e: XastElement) => boolean, elems: XastNode[]): XastElement | null {
  for (const elem of elems) {
    if (isTag(elem)) {
      if (test(elem))
        return elem
      const result = findOne(test, getChildren(elem))
      if (result)
        return result
    }
  }
  return null
}

export function createAdapter(relativeNode: XastParent, parents?: Map<XastNode, XastParent>): any {
  const getParent = (node: XastNode): XastParent | null => {
    if (!parents)
      parents = mapNodesToParents(relativeNode)
    return parents.get(node) ?? null
  }

  const getSiblings = (elem: XastNode): XastNode[] => {
    const parent = getParent(elem)
    return parent ? getChildren(parent) : []
  }

  const removeSubsets = (nodes: XastNode[]): XastNode[] => {
    let idx = nodes.length
    while (--idx > -1) {
      const node: XastNode | null = nodes[idx]!
      let ancestor: XastNode | null = node
      nodes[idx] = null as any
      let replace = true
      while (ancestor) {
        if (nodes.includes(ancestor)) {
          replace = false
          nodes.splice(idx, 1)
          break
        }
        ancestor = getParent(ancestor)
      }
      if (replace)
        nodes[idx] = node
    }
    return nodes
  }

  return {
    isTag,
    existsOne,
    getAttributeValue,
    getChildren,
    getName,
    getParent,
    getSiblings,
    getText,
    hasAttrib,
    removeSubsets,
    findAll,
    findOne,
  }
}
