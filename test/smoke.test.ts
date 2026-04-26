import { describe, expect, it } from 'bun:test'
import { parsePath, parseSVG, parseTransform, rasterize, Resvg, svgToPng } from '../src'

const SIMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60">
  <rect width="100%" height="100%" fill="white"/>
  <path d="M 10 10 L 90 10 L 90 50 L 10 50 Z" fill="black"/>
</svg>`

describe('parser', () => {
  it('rejects non-svg input', () => {
    expect(() => parseSVG('<div>nope</div>')).toThrow()
  })

  it('reads width / height / viewBox', () => {
    const root = parseSVG(SIMPLE)
    expect(root.width).toBe(100)
    expect(root.height).toBe(60)
    expect(root.viewBox?.width).toBe(100)
    expect(root.viewBox?.height).toBe(60)
    expect(root.children).toHaveLength(2)
  })

  it('decodes the rect background and the path foreground', () => {
    const root = parseSVG(SIMPLE)
    expect(root.children[0]!.tag).toBe('rect')
    expect(root.children[1]!.tag).toBe('path')
  })
})

describe('path parser', () => {
  it('handles M L H V Z', () => {
    const cmds = parsePath('M0 0 L10 0 H20 V20 Z')
    expect(cmds.map(c => c.t)).toEqual(['M', 'L', 'L', 'L', 'Z'])
  })

  it('handles relative commands', () => {
    const cmds = parsePath('M10 10 l5 0 l0 5')
    expect(cmds[0]).toMatchObject({ t: 'M', x: 10, y: 10 })
    expect(cmds[1]).toMatchObject({ t: 'L', x: 15, y: 10 })
    expect(cmds[2]).toMatchObject({ t: 'L', x: 15, y: 15 })
  })

  it('handles cubic + smooth cubic', () => {
    const cmds = parsePath('M0 0 C 10 0 20 10 20 20 S 30 30 40 40')
    expect(cmds.map(c => c.t)).toEqual(['M', 'C', 'C'])
    // Smooth cubic reflects previous control2 around current point.
    const second = cmds[2] as { t: 'C', x1: number, y1: number, x2: number, y2: number, x: number, y: number }
    expect(second.x1).toBeCloseTo(20)
    expect(second.y1).toBeCloseTo(30)
  })
})

describe('transform parser', () => {
  it('parses translate + scale', () => {
    const m = parseTransform('translate(10 5) scale(2)')
    // Apply to (0,0) → (10, 5); apply to (1, 0) → (12, 5)
    expect(m[0]).toBe(2)
    expect(m[3]).toBe(2)
    expect(m[4]).toBe(10)
    expect(m[5]).toBe(5)
  })
})

describe('rasterizer', () => {
  it('produces a non-empty PNG buffer', () => {
    const png = svgToPng(SIMPLE)
    expect(png.byteLength).toBeGreaterThan(50)
    // PNG magic
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(png[2]).toBe(0x4E)
    expect(png[3]).toBe(0x47)
  })

  it('Resvg compat shim renders at zoom', () => {
    const r = new Resvg(SIMPLE, { fitTo: { mode: 'zoom', value: 2 } })
    const img = r.render()
    expect(img.width()).toBe(200)
    expect(img.height()).toBe(120)
    const png = img.asPng()
    expect(png.byteLength).toBeGreaterThan(50)
  })

  it('paints the rect background at the expected opacity', () => {
    const root = parseSVG(SIMPLE)
    const fb = rasterize(root)
    // Sample a pixel inside the rect-only area (top-left, before the path's
    // opaque inner box) — should be white.
    const idx = (5 * fb.width + 5) * 4
    expect(fb.data[idx]!).toBe(255)
    expect(fb.data[idx + 1]!).toBe(255)
    expect(fb.data[idx + 2]!).toBe(255)
    expect(fb.data[idx + 3]!).toBe(255)
    // Sample a pixel inside the inner black rect (e.g. (50, 30)).
    const idxInner = (30 * fb.width + 50) * 4
    expect(fb.data[idxInner]!).toBeLessThan(20)
  })
})
