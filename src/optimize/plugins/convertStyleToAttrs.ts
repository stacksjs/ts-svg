/** Promote inline-style declarations to presentation attributes. (Adapted from SVGO, MIT.) */
import type { Plugin } from '../types'
import { csstree } from '@stacksjs/ts-css'
import { attrsGroups } from './_collections'

export interface ConvertStyleToAttrsParams {
  keepImportant?: boolean
}

export const name = 'convertStyleToAttrs'
export const description = 'converts style to attributes'

const g = (...args: string[]): string => `(?:${args.join('|')})`
const stylingProps = attrsGroups.presentation!
const rEscape = '\\\\(?:[0-9a-f]{1,6}\\s?|\\r\\n|.)'
const rSingleQuotes = `'(?:[^'\\n\\r\\\\]|${rEscape})*?(?:'|$)`
const rQuotes = `"(?:[^"\\n\\r\\\\]|${rEscape})*?(?:"|$)`
const rQuotedString = new RegExp(`^${g(rSingleQuotes, rQuotes)}$`)
const regStripComments = new RegExp(g(rEscape, rSingleQuotes, rQuotes, '/\\*[^]*?\\*/'), 'ig')

export const fn: Plugin<ConvertStyleToAttrsParams> = (_root, params) => {
  const { keepImportant = false } = params || {}
  return {
    element: {
      enter: (node) => {
        if (node.attributes.style != null) {
          let styles: Array<[string, string]> = []
          const newAttributes: Record<string, string> = {}
          const styleValue = node.attributes.style.replace(regStripComments, (match) => {
            return match[0] === '/'
              ? ''
              : match[0] === '\\' && /[-g-z]/i.test(match[1]!)
              ? match[1]!
              : match
          })
          // Use the same CSS parser as the style cascade. The previous nested
          // declaration regex had ambiguous nested captures rejected by bounded
          // engines. Parse quoted delimiters as CSS tokens instead.
          let malformed = false
          const declarations = csstree.parse(styleValue, {
            context: 'declarationList',
            parseValue: false,
            onParseError: () => { malformed = true },
          })
          // A recovering parse must not silently discard unknown CSS text.
          if (malformed || declarations.type !== 'DeclarationList')
            return
          declarations.children.forEach((declaration) => {
            if (declaration.type === 'Declaration' && (!keepImportant || !declaration.important))
              styles.push([declaration.property, csstree.generate(declaration.value)])
          })

          if (styles.length) {
            styles = styles.filter((style) => {
              if (style[0]) {
                const prop = style[0].toLowerCase()
                let val = style[1]
                if (rQuotedString.test(val))
                  val = val.slice(1, -1)
                if (stylingProps.has(prop)) {
                  newAttributes[prop] = val
                  return false
                }
              }
              return true
            })

            Object.assign(node.attributes, newAttributes)

            if (styles.length)
              node.attributes.style = styles.map(d => d.join(':')).join(';')
            else
              delete node.attributes.style
          }
        }
      },
    },
  }
}
