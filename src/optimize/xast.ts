/**
 * xast tree helpers + CSS-selector queries via `@stacksjs/ts-css`.
 */

import type { XastChild, XastElement, XastNode, XastParent } from './types'
import { is, selectAll, selectOne } from '@stacksjs/ts-css'
import { createAdapter } from './css-select-adapter'

function createCssSelectOptions(relativeNode: XastParent, parents?: Map<XastNode, XastParent>): any {
  return {
    xmlMode: true,
    adapter: createAdapter(relativeNode, parents),
  }
}

export function querySelectorAll(node: XastParent, selector: string, parents?: Map<XastNode, XastParent>): XastChild[] {
  return selectAll(selector, node as any, createCssSelectOptions(node, parents)) as XastChild[]
}

export function querySelector(node: XastParent, selector: string, parents?: Map<XastNode, XastParent>): XastChild | null {
  return selectOne(selector, node as any, createCssSelectOptions(node, parents)) as XastChild | null
}

export function matches(node: XastElement, selector: string, parents?: Map<XastNode, XastParent>): boolean {
  return is(node as any, selector, createCssSelectOptions(node, parents))
}

export function detachNodeFromParent(node: XastChild, parentNode: XastParent): void {
  parentNode.children = parentNode.children.filter(child => child !== node)
}
