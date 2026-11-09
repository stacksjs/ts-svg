import { expect, it } from 'bun:test'
import type { XastElement, XastRoot } from '../src/optimize/types'
import { optimize } from '../src/optimize'
import { fn } from '../src/optimize/plugins/convertStyleToAttrs'
import { declarationCases } from './fixtures/style-declarations'

for (const { style, keepImportant, expected } of declarationCases) {
  it(`parses style declarations ${JSON.stringify(style)} (keepImportant=${keepImportant})`, () => {
    const node: XastElement = { type: 'element', name: 'path', attributes: { style }, children: [] }
    const root: XastRoot = { type: 'root', children: [node] }
    const visitor = fn(root, { keepImportant }, { multipassCount: 0 })!
    visitor.element!.enter!(node, root)
    expect(node.attributes).toEqual(expected)
  })
}

it('converts declarations through the public optimizer without splitting quoted delimiters', () => {
  const input = '<svg><path style="fill:red;stroke:blue;unknown:var(--x, rgb(1,2,3))"/></svg>'
  expect(optimize(input, { plugins: ['convertStyleToAttrs'] }).data)
    .toBe('<svg><path style="unknown:var(--x, rgb(1,2,3))" fill="red" stroke="blue"/></svg>')
})
