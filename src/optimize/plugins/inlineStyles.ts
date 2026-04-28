/** Move CSS rules from `<style>` into matching elements' `style=` attributes. (Adapted from SVGO, MIT.) */

import type { Plugin, Specificity, XastElement, XastParent } from '../types'
import { csstree, csso } from '@stacksjs/ts-css'

const { syntax } = csso
import { compareSpecificity, includesAttrSelector } from '../style'
import { visitSkip } from '../util/visit'
import { detachNodeFromParent, querySelectorAll } from '../xast'
import { attrsGroups, pseudoClasses } from './_collections'

export interface InlineStylesParams {
  onlyMatchedOnce?: boolean
  removeMatchedSelectors?: boolean
  useMqs?: string[]
  usePseudos?: string[]
}

export const name = 'inlineStyles'
export const description = 'inline styles (additional options)'

const preservedPseudos = [
  ...(pseudoClasses.functional ?? new Set()),
  ...(pseudoClasses.treeStructural ?? new Set()),
]

interface StyleEntry {
  node: XastElement
  parentNode: XastParent
  cssAst: csstree.StyleSheet
}

interface SelectorEntry {
  node: csstree.Selector
  item: csstree.ListItem<csstree.CssNode>
  rule: csstree.Rule
  matchedElements?: XastElement[]
}

export const fn: Plugin<InlineStylesParams> = (root, params) => {
  const {
    onlyMatchedOnce = true,
    removeMatchedSelectors = true,
    useMqs = ['', 'screen'],
    usePseudos = [''],
  } = params || {}

  const styles: StyleEntry[] = []
  const selectors: SelectorEntry[] = []

  return {
    element: {
      enter: (node, parentNode) => {
        if (node.name === 'foreignObject')
          return visitSkip
        if (node.name !== 'style' || node.children.length === 0)
          return
        if (node.attributes.type != null && node.attributes.type !== '' && node.attributes.type !== 'text/css')
          return

        const cssText = node.children
          .filter(c => c.type === 'text' || c.type === 'cdata')
          .map(c => (c as { value: string }).value)
          .join('')

        let cssAst: csstree.CssNode | null = null
        try {
          cssAst = csstree.parse(cssText, { parseValue: false, parseCustomProperty: false })
        }
        catch {
          return
        }
        if (cssAst.type === 'StyleSheet')
          styles.push({ node, parentNode, cssAst: cssAst as csstree.StyleSheet })

        csstree.walk(cssAst, {
          visit: 'Rule',
          enter(ruleNode) {
            const atrule = (this as any).atrule
            let mediaQuery = ''
            if (atrule != null) {
              mediaQuery = atrule.name
              if (atrule.prelude != null)
                mediaQuery += ` ${csstree.generate(atrule.prelude)}`
            }
            if (!useMqs.includes(mediaQuery))
              return

            if (ruleNode.prelude.type === 'SelectorList') {
              ruleNode.prelude.children.forEach((childNode, item) => {
                if (childNode.type === 'Selector') {
                  const pseudos: Array<{ item: csstree.ListItem<csstree.CssNode>, list: csstree.List<csstree.CssNode> }> = []
                  childNode.children.forEach((g, gi, gl) => {
                    const isPseudo = g.type === 'PseudoClassSelector' || g.type === 'PseudoElementSelector'
                    if (isPseudo && !preservedPseudos.includes((g as any).name))
                      pseudos.push({ item: gi, list: gl })
                  })
                  const pseudoSelectors = csstree.generate({
                    type: 'Selector',
                    children: new csstree.List<csstree.CssNode>().fromArray(pseudos.map(p => p.item.data)),
                  })
                  if (usePseudos.includes(pseudoSelectors)) {
                    for (const p of pseudos)
                      p.list.remove(p.item)
                  }
                  selectors.push({ node: childNode, rule: ruleNode, item })
                }
              })
            }
          },
        })
      },
    },
    root: {
      exit: () => {
        if (styles.length === 0)
          return
        const sortedSelectors = selectors
          .slice()
          .sort((a, b) => {
            const aS = syntax.specificity(a.item.data) as Specificity
            const bS = syntax.specificity(b.item.data) as Specificity
            return compareSpecificity(aS, bS)
          })
          .reverse()

        for (const selector of sortedSelectors) {
          const selectorText = csstree.generate(selector.item.data)
          const matchedElements: XastElement[] = []
          try {
            for (const node of querySelectorAll(root, selectorText)) {
              if (node.type === 'element')
                matchedElements.push(node)
            }
          }
          catch {
            continue
          }
          if (matchedElements.length === 0)
            continue
          if (onlyMatchedOnce && matchedElements.length > 1)
            continue

          for (const selectedEl of matchedElements) {
            const styleDeclarationList = csstree.parse(selectedEl.attributes.style ?? '', {
              context: 'declarationList',
              parseValue: false,
            })
            if (styleDeclarationList.type !== 'DeclarationList')
              continue
            const styleDeclarationItems = new Map<string, csstree.ListItem<csstree.CssNode>>()
            let firstListItem: csstree.ListItem<csstree.CssNode> | null = null

            csstree.walk(styleDeclarationList, {
              visit: 'Declaration',
              enter(declNode, item) {
                if (item == null)
                  return
                if (firstListItem == null)
                  firstListItem = item
                styleDeclarationItems.set((declNode as any).property.toLowerCase(), item)
              },
            })

            csstree.walk(selector.rule, {
              visit: 'Declaration',
              enter(ruleDeclaration) {
                const property = (ruleDeclaration as any).property
                if (
                  attrsGroups.presentation!.has(property)
                  && !selectors.some(s => includesAttrSelector(s.item, property))
                ) {
                  delete selectedEl.attributes[property]
                }
                const matchedItem = styleDeclarationItems.get(property)
                const ruleDeclarationItem = styleDeclarationList.children.createItem(ruleDeclaration)
                if (matchedItem == null) {
                  styleDeclarationList.children.insert(ruleDeclarationItem, firstListItem!)
                }
                else if (
                  (matchedItem.data as any).important !== true
                  && (ruleDeclaration as any).important === true
                ) {
                  styleDeclarationList.children.replace(matchedItem, ruleDeclarationItem)
                  styleDeclarationItems.set(property, ruleDeclarationItem)
                }
              },
            })

            const newStyles = csstree.generate(styleDeclarationList)
            if (newStyles.length !== 0)
              selectedEl.attributes.style = newStyles
          }

          if (
            removeMatchedSelectors
            && matchedElements.length !== 0
            && selector.rule.prelude.type === 'SelectorList'
          ) {
            selector.rule.prelude.children.remove(selector.item)
          }
          selector.matchedElements = matchedElements
        }

        if (!removeMatchedSelectors)
          return

        for (const selector of sortedSelectors) {
          if (selector.matchedElements == null)
            continue
          if (onlyMatchedOnce && selector.matchedElements.length > 1)
            continue
          for (const selectedEl of selector.matchedElements) {
            const classList = new Set(
              selectedEl.attributes.class == null ? null : selectedEl.attributes.class.split(' '),
            )
            selector.node.children.forEach((child) => {
              if (
                child.type === 'ClassSelector'
                && !selectors.some(s => includesAttrSelector(s.item, 'class', child.name, true))
              ) {
                classList.delete(child.name)
              }
            })
            if (classList.size === 0)
              delete selectedEl.attributes.class
            else
              selectedEl.attributes.class = Array.from(classList).join(' ')

            const firstSubSelector = selector.node.children.first
            if (
              firstSubSelector?.type === 'IdSelector'
              && selectedEl.attributes.id === firstSubSelector.name
              && !selectors.some(s => includesAttrSelector(s.item, 'id', firstSubSelector.name, true))
            ) {
              delete selectedEl.attributes.id
            }
          }
        }

        for (const style of styles) {
          csstree.walk(style.cssAst, {
            visit: 'Rule',
            enter(ruleNode, item, list) {
              if (
                ruleNode.type === 'Rule'
                && ruleNode.prelude.type === 'SelectorList'
                && ruleNode.prelude.children.isEmpty
              ) {
                if (list && item)
                  list.remove(item)
              }
            },
          })

          if (style.cssAst.children.isEmpty) {
            detachNodeFromParent(style.node, style.parentNode)
          }
          else {
            const firstChild = style.node.children[0]
            if (firstChild && (firstChild.type === 'text' || firstChild.type === 'cdata'))
              firstChild.value = csstree.generate(style.cssAst)
          }
        }
      },
    },
  }
}
