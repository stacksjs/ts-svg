import { describe, expect, it } from 'bun:test'
import { optimize as svgo } from 'svgo'
import { optimize } from '../src/optimize'

/**
 * The plugins that read and rewrite CSS through `@stacksjs/ts-css`. Nothing
 * else in the suite exercised them (the SVGO fixture run is skipped where the
 * SVGO repository is not checked out), so a ts-css upgrade could have changed
 * their output unseen. Each case here matches SVGO's own output.
 */
const cases: Record<string, string> = {
  'prefixIds rewrites an id referenced from a stylesheet': `<svg xmlns="http://www.w3.org/2000/svg"><style>#g1 { fill: url(#grad) }</style><defs><linearGradient id="grad"/></defs><rect id="g1" width="5" height="5"/></svg>`,
  'inlineStyles resolves a structural selector': `<svg xmlns="http://www.w3.org/2000/svg"><style>g > rect:first-child { opacity: .5 }</style><g><rect width="1" height="1"/><rect width="2" height="2"/></g></svg>`,
}

describe('CSS plugins (ts-css)', () => {
  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      expect(optimize(input).data).toBe(svgo(input).data)
    })
  }

  it('inlines a class and an id rule onto their elements and drops the stylesheet', () => {
    const output = optimize(`<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red} #b{stroke:#00f}</style><rect class="a" width="10" height="10"/><circle id="b" r="5"/></svg>`).data
    expect(output).not.toContain('<style>')
    expect(output).toContain('style="fill:red"')
    expect(output).toContain('style="stroke:#00f"')
  })
})
