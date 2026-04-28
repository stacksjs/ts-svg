/** Remove comments, with an opt-in preserve list. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export interface RemoveCommentsParams {
  preservePatterns?: ReadonlyArray<RegExp | string> | false
}

export const name = 'removeComments'
export const description = 'removes comments'

const DEFAULT_PRESERVE_PATTERNS: ReadonlyArray<RegExp> = [/^!/]

export const fn: Plugin<RemoveCommentsParams> = (_root, params) => {
  const { preservePatterns = DEFAULT_PRESERVE_PATTERNS } = params || {}
  return {
    comment: {
      enter: (node, parentNode) => {
        if (preservePatterns) {
          if (!Array.isArray(preservePatterns)) {
            throw new Error(`Expected array in removeComments preservePatterns parameter but received ${preservePatterns}`)
          }
          const matched = preservePatterns.some(pattern => new RegExp(pattern).test(node.value))
          if (matched)
            return
        }
        detachNodeFromParent(node, parentNode)
      },
    },
  }
}
