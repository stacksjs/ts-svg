/**
 * Tree-walker for the xast tree. Plugins return a `Visitor` object;
 * `visit` recursively calls its enter/exit callbacks.
 *
 * The walker is structured so that:
 *  - returning `visitSkip` from `enter` skips children + exit;
 *  - mutations to `parent.children` are tolerated mid-walk (we only
 *    descend if the current node is still attached to its parent).
 */

import type { Visitor, XastNode, XastParent } from '../types'

export const visitSkip: unique symbol = Symbol('visitSkip')

export function visit(node: XastNode, visitor: Visitor, parentNode?: XastParent | null): void {
  const callbacks = (visitor as any)[node.type]
  if (callbacks?.enter) {
    const symbol = callbacks.enter(node, parentNode ?? null)
    if (symbol === visitSkip)
      return
  }

  if (node.type === 'root') {
    // Snapshot via index loop — children may be filtered/spliced in callbacks.
    const children = node.children.slice()
    for (let i = 0; i < children.length; i++)
      visit(children[i], visitor, node)
  }

  if (node.type === 'element') {
    if (parentNode && (parentNode as any).children.includes(node)) {
      const children = node.children.slice()
      for (let i = 0; i < children.length; i++)
        visit(children[i], visitor, node)
    }
  }

  if (callbacks?.exit)
    callbacks.exit(node, parentNode ?? null)
}
