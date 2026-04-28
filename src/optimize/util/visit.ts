/**
 * Tree-walker for the xast tree. Plugins return a `Visitor` object;
 * `visit` recursively calls its enter/exit callbacks.
 *
 * Behaviour:
 *  - `visitSkip` from `enter` skips children + exit;
 *  - mutations to `parent.children` are tolerated mid-walk: a child detached
 *    by an earlier sibling's enter() will not be descended into.
 *
 * Performance: SVGO's reference impl does an O(N) `.includes()` membership
 * check on the parent's children for every visited element, so a wide parent
 * walks in O(N²). We snapshot the parent's children into a Set once before
 * descending so each membership lookup is O(1) and the whole walk is O(N).
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

  let descend = false
  if (node.type === 'root') {
    descend = true
  }
  else if (node.type === 'element' && parentNode) {
    // Was the node detached by an earlier sibling's enter()? svgo does an
    // O(N) `.includes()`. We try cheap O(1) endpoint checks first — the
    // overwhelming majority of plugin passes don't detach anything, so the
    // node is still in its original position.
    const pc = parentNode.children
    descend = pc[pc.length - 1] === node || pc[0] === node || pc.indexOf(node) >= 0
  }

  if (descend) {
    // Snapshot via index loop — callbacks may splice the array.
    const children = node.children
    const snapshot = children.length > 1 ? children.slice() : children
    for (let i = 0; i < snapshot.length; i++)
      visit(snapshot[i]!, visitor, node as XastParent)
  }

  // Exit always runs (matches svgo semantics — even detached nodes get an
  // exit callback so plugins can finalise their accumulated state).
  if (callbacks?.exit)
    callbacks.exit(node, parentNode ?? null)
}
