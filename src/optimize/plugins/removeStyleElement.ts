/** Remove `<style>` elements. (Adapted from SVGO, MIT.) */

import type { Plugin } from '../types'
import { detachNodeFromParent } from '../xast'

export const name = 'removeStyleElement'
export const description = 'removes <style> element'

export const fn: Plugin = () => ({
  element: {
    enter: (node, parentNode) => {
      if (node.name === 'style')
        detachNodeFromParent(node, parentNode)
    },
  },
})
