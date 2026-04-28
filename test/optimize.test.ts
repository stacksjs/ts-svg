import { describe, expect, it } from 'bun:test'
import { optimize, parseSvg, stringifySvg } from '../src/optimize'

describe('optimize', () => {
  it('runs default preset on a simple SVG', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <!-- a comment -->
      <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
    </svg>`
    const out = optimize(input).data
    expect(out).toContain('<svg')
    expect(out).not.toContain('<!--')
    expect(out).toContain('fill="red"')
  })

  it('preserves comments matched by preservePatterns', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><!--! keep me --></svg>`
    const out = optimize(input).data
    expect(out).toContain('keep me')
  })

  it('collapses identity transform', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(0,0)"><path d="M0 0L10 10"/></g></svg>`
    const out = optimize(input).data
    expect(out).not.toContain('translate(0,0)')
  })

  it('round-trips through parser/stringifier', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>`
    const ast = parseSvg(input)
    const out = stringifySvg(ast)
    expect(out).toContain('<circle')
    expect(out).toContain('cx="5"')
  })

  it('shortens hex colors', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#ff0000"/></svg>`
    const out = optimize(input).data
    expect(out).toContain('fill="red"')
  })

  it('multipass keeps shrinking until stable', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><g><g><rect width="10" height="10"/></g></g></svg>`
    const single = optimize(input).data
    const multi = optimize(input, { multipass: true }).data
    expect(multi.length).toBeLessThanOrEqual(single.length)
  })

  it('sorts attributes deterministically', () => {
    const a = optimize(`<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10"/></svg>`).data
    const b = optimize(`<svg xmlns="http://www.w3.org/2000/svg"><rect height="10" width="10" y="0" x="0"/></svg>`).data
    expect(a).toBe(b)
  })

  it('removes empty containers', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><defs></defs><g></g><rect width="1" height="1"/></svg>`
    const out = optimize(input).data
    expect(out).not.toContain('<defs/>')
    expect(out).not.toContain('<g/>')
  })

  it('removeAttrs plugin works', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="red" stroke="blue"/></svg>`
    const out = optimize(input, { plugins: [{ name: 'removeAttrs', params: { attrs: '(fill|stroke)' } }] }).data
    expect(out).not.toContain('fill=')
    expect(out).not.toContain('stroke=')
  })
})
