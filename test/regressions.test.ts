import { describe, expect, it } from 'bun:test'
import png from '@stacksjs/ts-png'
import { BLACK, parseColor, parseSVG, Resvg, TRANSPARENT } from '../src'

interface Pixel { r: number, g: number, b: number, a: number }

function pixelAt(buf: Buffer, x: number, y: number): Pixel {
  const decoded = png.sync.read(buf)
  const idx = (y * decoded.width + x) * 4
  return {
    r: decoded.data[idx]!,
    g: decoded.data[idx + 1]!,
    b: decoded.data[idx + 2]!,
    a: decoded.data[idx + 3]!,
  }
}

function approx(actual: Pixel, target: Pixel, tol = 8): void {
  expect(Math.abs(actual.r - target.r)).toBeLessThanOrEqual(tol)
  expect(Math.abs(actual.g - target.g)).toBeLessThanOrEqual(tol)
  expect(Math.abs(actual.b - target.b)).toBeLessThanOrEqual(tol)
  expect(Math.abs(actual.a - target.a)).toBeLessThanOrEqual(tol)
}

function render(svg: string): Buffer {
  return new Resvg(svg).render().asPng()
}

describe('parseColor: shared constants are not mutated', () => {
  it('successive parses of "transparent" return distinct objects', () => {
    const a = parseColor('transparent')
    const b = parseColor('transparent')
    expect(a).not.toBe(b)
    a.a = 99
    expect(b.a).toBe(0)
    expect(TRANSPARENT.a).toBe(0)
  })
  it('successive parses of "currentColor" return distinct objects from defaults', () => {
    const a = parseColor('currentColor')
    a.r = 99
    expect(BLACK.r).toBe(0)
  })
})

describe('parseSVG: error messages are specific', () => {
  it('rejects empty input with a typed error', () => {
    expect(() => parseSVG('')).toThrow(/non-empty/)
  })
  it('rejects non-svg root with the actual tag name in the message', () => {
    expect(() => parseSVG('<html></html>')).toThrow(/<html>/)
  })
})

describe('<defs> contents are not rendered as part of the tree', () => {
  // A <rect> inside <defs> with no <use> reference should NOT paint.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="white"/>
    <defs>
      <rect x="0" y="0" width="100" height="100" fill="red"/>
    </defs>
  </svg>`
  const buf = render(SVG)
  it('canvas stays white (red defs rect is invisible)', () =>
    approx(pixelAt(buf, 50, 50), { r: 255, g: 255, b: 255, a: 255 }))
})

describe('<use> recursion guard does not blow the stack', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
    <defs><g id="cycle"><use href="#cycle"/></g></defs>
    <use href="#cycle"/>
  </svg>`
  it('renders without throwing', () => {
    expect(() => render(SVG)).not.toThrow()
  })
})

describe('gradient href chaining (xlink:href stop inheritance)', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="base">
        <stop offset="0" stop-color="black"/>
        <stop offset="1" stop-color="white"/>
      </linearGradient>
      <linearGradient id="g" xlink:href="#base" x1="0" y1="0" x2="1" y2="0"/>
    </defs>
    <rect width="100" height="100" fill="url(#g)"/>
  </svg>`
  const buf = render(SVG)
  it('inherits stops from #base and renders gradient', () => {
    approx(pixelAt(buf, 1, 50), { r: 0, g: 0, b: 0, a: 255 }, 24)
    approx(pixelAt(buf, 98, 50), { r: 255, g: 255, b: 255, a: 255 }, 24)
  })
})

describe('paint-server fill cascades to children that don\'t set fill', () => {
  // The <g fill="red"> sets fill at the group level; the inner <rect> with no
  // own fill should pick it up. Same mechanism is what enables `fill="url(#g)"`
  // to cascade — exercising solid colour here for stability across renderers.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="white"/>
    <g fill="red"><rect x="20" y="20" width="60" height="60"/></g>
  </svg>`
  const buf = render(SVG)
  it('child inherits group fill', () => approx(pixelAt(buf, 50, 50), { r: 255, g: 0, b: 0, a: 255 }))
})

describe('mask-type=alpha uses raw alpha (not luminance)', () => {
  // A red mask at full alpha. luminance(red) ≈ 0.299 → if treated as luminance,
  // the masked target alpha would be ~76. With mask-type=alpha, target
  // preserves full alpha (~255).
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <defs>
      <mask id="m" mask-type="alpha">
        <rect width="40" height="40" fill="red"/>
      </mask>
    </defs>
    <rect width="40" height="40" fill="black" mask="url(#m)"/>
  </svg>`
  const buf = render(SVG)
  it('preserves full alpha through the alpha-typed mask', () => {
    expect(pixelAt(buf, 20, 20).a).toBeGreaterThan(200)
  })
})

describe('currentColor cascade resolves via the `color` attribute', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" color="red">
    <rect width="60" height="60" fill="white"/>
    <rect x="10" y="10" width="40" height="40" fill="currentColor"/>
  </svg>`
  const buf = render(SVG)
  it('child fill picks up the cascaded currentColor', () =>
    approx(pixelAt(buf, 30, 30), { r: 255, g: 0, b: 0, a: 255 }))
})

describe('group opacity composites the layer once (not per child)', () => {
  // Two overlapping black squares inside opacity=0.5 group. With per-child
  // opacity the overlap would be darker than non-overlap; with proper layer
  // opacity all painted pixels share the same final alpha.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="white"/>
    <g opacity="0.5">
      <rect x="20" y="20" width="50" height="50" fill="black"/>
      <rect x="40" y="40" width="50" height="50" fill="black"/>
    </g>
  </svg>`
  const buf = render(SVG)
  it('overlap region equals non-overlap region (within tolerance)', () => {
    const overlap = pixelAt(buf, 50, 50)        // both squares cover this pixel
    const nonOverlap = pixelAt(buf, 25, 25)     // only first square covers this pixel
    expect(Math.abs(overlap.r - nonOverlap.r)).toBeLessThanOrEqual(8)
  })
})

describe('viewBox with negative dims is rejected (no NaN propagation)', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 -100 -100">
    <rect width="50" height="50" fill="black"/>
  </svg>`
  it('renders without throwing', () => expect(() => render(SVG)).not.toThrow())
})

describe('parseLengthPercent honours common units', () => {
  // 12pt at 96dpi == 16px. Use stroke-width as a proxy because it goes
  // straight through parseNumber, not parseLengthPercent — fall back to
  // testing a font-size-driven render path is complex; assert via root width
  // sizing instead, which DOES go through parseLengthPercent.
  it('width="100px" parses as 100 user units', () => {
    const root = parseSVG('<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="100px"/>')
    expect(root.width).toBe(100)
    expect(root.height).toBe(100)
  })
  it('width="1in" parses as 96 user units', () => {
    const root = parseSVG('<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="1in"/>')
    expect(root.width).toBe(96)
  })
})

describe('flattenCommands: drawing continues after Z without an explicit M', () => {
  // The path: M 0 0  L 10 0  L 10 10  Z  L 5 5
  // After Z, `L 5 5` should draw from the subpath start (0,0) to (5,5)
  // instead of being silently dropped.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
    <rect width="60" height="60" fill="white"/>
    <path d="M 5 5 L 55 5 L 55 55 Z L 5 55" fill="none" stroke="black" stroke-width="3"/>
  </svg>`
  const buf = render(SVG)
  it('renders the post-Z lineto (left edge stroked)', () => {
    // Pixel (5, 30) sits on the left edge created by the post-Z `L 5 55` line.
    const p = pixelAt(buf, 5, 30)
    expect(p.r).toBeLessThan(120)
  })
})
