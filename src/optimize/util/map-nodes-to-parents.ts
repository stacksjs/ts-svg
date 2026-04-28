import type { XastElement, XastNode, XastParent } from '../types'
import { visit } from './visit'

/** Build a parent-pointer map for the entire subtree rooted at `node`. */
export function mapNodesToParents(node: XastParent): Map<XastNode, XastParent> {
  const parents = new Map<XastNode, XastParent>()

  for (const child of node.children) {
    parents.set(child, node)
    visit(
      child,
      {
        element: {
          enter: (childNode: XastElement, parent: XastParent) => {
            parents.set(childNode, parent)
          },
        },
      },
      node,
    )
  }

  return parents
}
