import { describe, expect, it } from 'bun:test'
import png from 'ts-png'
import { Resvg } from '../src'

/**
 * Per-fixture: render an SVG to PNG and assert structural pixel facts —
 * the colour at specific sample points, total opaque coverage, and (for
 * AA stress tests) the absence of NaN/clipping.
 *
 * We don't ship reference PNGs to disk because we control the renderer —
 * any drift would invalidate the reference. Instead we assert
 * algorithmically: "this region must be red within ±tolerance".
 */

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

function render(svg: string, scale = 1): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } }).render().asPng()
}

describe('fixture: solid rect', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="white"/>
    <rect x="20" y="20" width="60" height="60" fill="rgb(255,128,0)"/>
  </svg>`
  const buf = render(SVG)
  it('paints background white at (5,5)', () => approx(pixelAt(buf, 5, 5), { r: 255, g: 255, b: 255, a: 255 }))
  it('paints inner rect orange at (50,50)', () => approx(pixelAt(buf, 50, 50), { r: 255, g: 128, b: 0, a: 255 }))
  it('inner rect edge at (20,50) has full coverage', () => {
    const p = pixelAt(buf, 21, 50)
    expect(p.a).toBe(255)
    approx(p, { r: 255, g: 128, b: 0, a: 255 }, 4)
  })
})

describe('fixture: rounded rect', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="white"/>
    <rect x="20" y="20" width="60" height="60" rx="20" ry="20" fill="black"/>
  </svg>`
  const buf = render(SVG)
  it('center is black', () => approx(pixelAt(buf, 50, 50), { r: 0, g: 0, b: 0, a: 255 }))
  it('top-left corner of bbox is white (corner cut by radius)', () =>
    approx(pixelAt(buf, 21, 21), { r: 255, g: 255, b: 255, a: 255 }, 32))
  it('mid-edge is black', () => approx(pixelAt(buf, 50, 22), { r: 0, g: 0, b: 0, a: 255 }))
})

describe('fixture: linear gradient', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="black"/>
        <stop offset="1" stop-color="white"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#g)"/>
  </svg>`
  const buf = render(SVG)
  it('left edge is black', () => approx(pixelAt(buf, 1, 50), { r: 0, g: 0, b: 0, a: 255 }, 16))
  it('right edge is white', () => approx(pixelAt(buf, 98, 50), { r: 255, g: 255, b: 255, a: 255 }, 16))
  it('middle is mid-grey', () => approx(pixelAt(buf, 50, 50), { r: 128, g: 128, b: 128, a: 255 }, 16))
})

describe('fixture: radial gradient', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
      <radialGradient id="g" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="white"/>
        <stop offset="1" stop-color="black"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#g)"/>
  </svg>`
  const buf = render(SVG)
  it('center is white', () => approx(pixelAt(buf, 50, 50), { r: 255, g: 255, b: 255, a: 255 }, 16))
  it('corner is black', () => approx(pixelAt(buf, 1, 1), { r: 0, g: 0, b: 0, a: 255 }, 32))
})

describe('fixture: clip path', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs><clipPath id="c"><circle cx="50" cy="50" r="30"/></clipPath></defs>
    <rect width="100" height="100" fill="white"/>
    <rect width="100" height="100" fill="black" clip-path="url(#c)"/>
  </svg>`
  const buf = render(SVG)
  it('inside circle is black', () => approx(pixelAt(buf, 50, 50), { r: 0, g: 0, b: 0, a: 255 }))
  it('outside circle is white', () => approx(pixelAt(buf, 5, 5), { r: 255, g: 255, b: 255, a: 255 }))
})

describe('fixture: use reference', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs><circle id="dot" cx="0" cy="0" r="10" fill="red"/></defs>
    <rect width="100" height="100" fill="white"/>
    <use href="#dot" x="20" y="20"/>
    <use href="#dot" x="80" y="80"/>
  </svg>`
  const buf = render(SVG)
  it('first use is red', () => approx(pixelAt(buf, 20, 20), { r: 255, g: 0, b: 0, a: 255 }, 24))
  it('second use is red', () => approx(pixelAt(buf, 80, 80), { r: 255, g: 0, b: 0, a: 255 }, 24))
  it('between uses is white', () => approx(pixelAt(buf, 50, 50), { r: 255, g: 255, b: 255, a: 255 }))
})

describe('fixture: stroke', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="white"/>
    <rect x="20" y="20" width="60" height="60" fill="none" stroke="black" stroke-width="4"/>
  </svg>`
  const buf = render(SVG)
  it('inside rect is white (no fill)', () => approx(pixelAt(buf, 50, 50), { r: 255, g: 255, b: 255, a: 255 }))
  it('on stroke edge is black', () => approx(pixelAt(buf, 20, 50), { r: 0, g: 0, b: 0, a: 255 }, 24))
})

describe('fixture: dashed stroke', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="20" viewBox="0 0 200 20">
    <line x1="0" y1="10" x2="200" y2="10" stroke="black" stroke-width="6" stroke-dasharray="20 10"/>
  </svg>`
  const buf = render(SVG)
  // First dash should cover x=0..20: pixel (5, 10) should be black.
  it('dash region is black', () => approx(pixelAt(buf, 5, 10), { r: 0, g: 0, b: 0, a: 255 }, 32))
  // Gap region (20..30): pixel (25, 10) should be transparent / background.
  it('gap region is transparent', () => {
    const p = pixelAt(buf, 25, 10)
    expect(p.a).toBeLessThan(40)
  })
})

describe('fixture: preserveAspectRatio meet', () => {
  // 200×100 viewBox rendered into a 200×200 viewport with default `xMidYMid meet`
  // should letterbox vertically: drawing fills horizontally, with empty
  // top/bottom bands.
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 100">
    <rect width="200" height="100" fill="black"/>
  </svg>`
  const buf = render(SVG)
  it('letterbox top is transparent', () => {
    const p = pixelAt(buf, 100, 5)
    expect(p.a).toBeLessThan(40)
  })
  it('mid is black', () => approx(pixelAt(buf, 100, 100), { r: 0, g: 0, b: 0, a: 255 }))
  it('letterbox bottom is transparent', () => {
    const p = pixelAt(buf, 100, 195)
    expect(p.a).toBeLessThan(40)
  })
})

describe('fixture: nested transforms', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="white"/>
    <g transform="translate(50 50)">
      <g transform="rotate(45)">
        <rect x="-20" y="-20" width="40" height="40" fill="red"/>
      </g>
    </g>
  </svg>`
  const buf = render(SVG)
  it('center is red', () => approx(pixelAt(buf, 50, 50), { r: 255, g: 0, b: 0, a: 255 }))
  // After 45° rotation, the rectangle is a diamond — the corners of the
  // original axis-aligned bbox at (10,10) etc. should be transparent/white.
  it('off-axis corner is white', () => approx(pixelAt(buf, 25, 25), { r: 255, g: 255, b: 255, a: 255 }, 32))
})
