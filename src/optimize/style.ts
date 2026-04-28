/**
 * CSS computed-style helper for the xast tree.
 *
 * Collects rules from `<style>` elements + `style=` inline declarations,
 * matches them against the document via css-select, and computes the
 * effective static / dynamic style for any element. Adapted from SVGO's
 * lib/style.js (MIT).
 */

import type { ComputedStyles, Specificity, Stylesheet, StylesheetDeclaration, StylesheetRule, XastElement, XastNode, XastParent, XastRoot } from './types'
import { csstree, cssWhat as csswhat, csso } from '@stacksjs/ts-css'

const { syntax } = csso
import { attrsGroups, inheritableAttrs, presentationNonInheritableGroupAttrs } from './plugins/_collections'
import { visit } from './util/visit'
import { matches } from './xast'

const csstreeWalkSkip = csstree.walk.skip

function parseRule(ruleNode: csstree.Rule, dynamic: boolean): StylesheetRule[] {
  const declarations: StylesheetDeclaration[] = []
  ruleNode.block.children.forEach((cssNode) => {
    if (cssNode.type === 'Declaration') {
      declarations.push({
        name: cssNode.property,
        value: csstree.generate(cssNode.value),
        important: cssNode.important === true,
      })
    }
  })

  const rules: StylesheetRule[] = []
  csstree.walk(ruleNode.prelude, (node) => {
    if (node.type === 'Selector') {
      const newNode = csstree.clone(node)
      let hasPseudoClasses = false
      csstree.walk(newNode, (pseudoClassNode, item, list) => {
        if (pseudoClassNode.type === 'PseudoClassSelector') {
          hasPseudoClasses = true
          if (list && item)
            list.remove(item)
        }
      })
      rules.push({
        specificity: syntax.specificity(node) as Specificity,
        dynamic: hasPseudoClasses || dynamic,
        selector: csstree.generate(newNode),
        declarations,
      })
    }
  })
  return rules
}

function parseStylesheet(css: string, dynamic: boolean): StylesheetRule[] {
  const rules: StylesheetRule[] = []
  const ast = csstree.parse(css, { parseValue: false, parseAtrulePrelude: false })
  csstree.walk(ast, (cssNode) => {
    if (cssNode.type === 'Rule') {
      rules.push(...parseRule(cssNode, dynamic || false))
      return csstreeWalkSkip
    }
    if (cssNode.type === 'Atrule') {
      if (['keyframes', '-webkit-keyframes', '-o-keyframes', '-moz-keyframes'].includes(cssNode.name))
        return csstreeWalkSkip
      csstree.walk(cssNode, (ruleNode) => {
        if (ruleNode.type === 'Rule') {
          rules.push(...parseRule(ruleNode, dynamic || true))
          return csstreeWalkSkip
        }
      })
      return csstreeWalkSkip
    }
  })
  return rules
}

function parseStyleDeclarations(css: string): StylesheetDeclaration[] {
  const declarations: StylesheetDeclaration[] = []
  const ast = csstree.parse(css, { context: 'declarationList', parseValue: false })
  csstree.walk(ast, (cssNode) => {
    if (cssNode.type === 'Declaration') {
      declarations.push({
        name: cssNode.property,
        value: csstree.generate(cssNode.value),
        important: cssNode.important === true,
      })
    }
  })
  return declarations
}

function computeOwnStyle(stylesheet: Stylesheet, node: XastElement, parents?: Map<XastNode, XastParent>): ComputedStyles {
  const computedStyle: ComputedStyles = {}
  const importantStyles = new Map<string, boolean>()

  for (const [name, value] of Object.entries(node.attributes)) {
    if (attrsGroups.presentation!.has(name)) {
      computedStyle[name] = { type: 'static', inherited: false, value }
      importantStyles.set(name, false)
    }
  }

  for (const { selector, declarations, dynamic } of stylesheet.rules) {
    if (matches(node, selector, parents)) {
      for (const { name, value, important } of declarations) {
        const computed = computedStyle[name]
        if (computed && computed.type === 'dynamic')
          continue
        if (dynamic) {
          computedStyle[name] = { type: 'dynamic', inherited: false }
          continue
        }
        if (
          computed == null
          || important === true
          || importantStyles.get(name) === false
        ) {
          computedStyle[name] = { type: 'static', inherited: false, value }
          importantStyles.set(name, important)
        }
      }
    }
  }

  const styleDeclarations
    = node.attributes.style == null ? [] : parseStyleDeclarations(node.attributes.style)
  for (const { name, value, important } of styleDeclarations) {
    const computed = computedStyle[name]
    if (computed && computed.type === 'dynamic')
      continue
    if (
      computed == null
      || important === true
      || importantStyles.get(name) === false
    ) {
      computedStyle[name] = { type: 'static', inherited: false, value }
      importantStyles.set(name, important)
    }
  }

  return computedStyle
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 4; i++) {
    if ((a as any)[i] < (b as any)[i])
      return -1
    if ((a as any)[i] > (b as any)[i])
      return 1
  }
  return 0
}

export function collectStylesheet(root: XastRoot): Stylesheet {
  const rules: StylesheetRule[] = []
  const parents = new Map<XastElement, XastParent>()

  visit(root, {
    element: {
      enter: (node, parentNode) => {
        parents.set(node, parentNode)
        if (node.name !== 'style')
          return
        if (
          node.attributes.type == null
          || node.attributes.type === ''
          || node.attributes.type === 'text/css'
        ) {
          const dynamic = node.attributes.media != null && node.attributes.media !== 'all'
          for (const child of node.children) {
            if (child.type === 'text' || child.type === 'cdata')
              rules.push(...parseStylesheet(child.value, dynamic))
          }
        }
      },
    },
  })
  rules.sort((a, b) => compareSpecificity(a.specificity, b.specificity))
  return { rules, parents }
}

export function computeStyle(stylesheet: Stylesheet, node: XastElement): ComputedStyles {
  const { parents } = stylesheet
  const computedStyles = computeOwnStyle(stylesheet, node, parents as any)
  let parent: XastParent | undefined = parents.get(node)
  while (parent != null && parent.type !== 'root') {
    const inheritedStyles = computeOwnStyle(stylesheet, parent, parents as any)
    for (const [name, computed] of Object.entries(inheritedStyles)) {
      if (
        computedStyles[name] == null
        && inheritableAttrs.has(name)
        && !presentationNonInheritableGroupAttrs.has(name)
      ) {
        computedStyles[name] = { ...computed, inherited: true }
      }
    }
    parent = parents.get(parent)
  }
  return computedStyles
}

export function includesAttrSelector(
  selector: csstree.ListItem<csstree.CssNode> | string,
  name: string,
  value: string | null = null,
  traversed: boolean = false,
): boolean {
  // SVG attribute names are case-sensitive (e.g. `preserveAspectRatio`),
  // so we parse selectors in xmlMode to keep the casing intact.
  const selectors = typeof selector === 'string'
    ? csswhat.parse(selector, { xmlMode: true })
    : csswhat.parse(csstree.generate(selector.data), { xmlMode: true })

  for (const subselector of selectors) {
    const hasAttrSelector = subselector.some((segment, index) => {
      if (traversed) {
        if (index === subselector.length - 1)
          return false
        const isNextTraversal = csswhat.isTraversal(subselector[index + 1]!)
        if (!isNextTraversal)
          return false
      }
      if (segment.type !== 'attribute' || segment.name !== name)
        return false
      return value == null ? true : (segment as any).value === value
    })
    if (hasAttrSelector)
      return true
  }
  return false
}
