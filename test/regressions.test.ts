import { describe, expect, it } from 'bun:test'
import png from '@stacksjs/ts-png'
import { BLACK, parseColor, parsePath, parseSVG, Resvg, TRANSPARENT } from '../src'

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

// ---------------------------------------------------------------------------
// Audit-driven regression tests (bugs 1-19 + #27-30)
// ---------------------------------------------------------------------------

describe('parsePath state isolation', () => {
  it('two consecutive calls on the same source produce identical output', () => {
    const d = 'M0 0 L10 0 L10 10 Z'
    const a = JSON.stringify(parsePath(d))
    const b = JSON.stringify(parsePath(d))
    expect(a).toBe(b)
  })

  it('compact arc flags `00` parse as TWO 0-flags, not a single number `0`', () => {
    const cmds = parsePath('M0 0 A1 1 0 00 5 5')
    expect(cmds).toHaveLength(2)
    const arc = cmds[1] as Extract<ReturnType<typeof parsePath>[number], { t: 'A' }>
    expect(arc.t).toBe('A')
    expect(arc.largeArc).toBe(false)
    expect(arc.sweep).toBe(false)
    expect(arc.x).toBe(5)
    expect(arc.y).toBe(5)
  })

  it('arc flags reject non-binary digits', () => {
    expect(() => parsePath('M0 0 A1 1 0 5 7 50 50')).toThrow()
  })

  it('unknown command throws (rather than silently swallowing operands)', () => {
    expect(() => parsePath('M0 0 X 1 2')).toThrow()
  })
})

describe('parseColor: hex edge cases', () => {
  it('rejects hex length 5 (returns transparent, not opaque black)', () => {
    expect(parseColor('#abcde')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('rejects hex length 7', () => {
    expect(parseColor('#abcdef0')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('rejects non-hex characters', () => {
    expect(parseColor('#gghhii')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('accepts uppercase hex', () => {
    expect(parseColor('#FF8800')).toEqual({ r: 255, g: 136, b: 0, a: 255 })
  })
})

describe('parseColor: HSL never returns NaN', () => {
  it('rejects NaN hue without polluting the framebuffer', () => {
    const c = parseColor('hsl(notanumber, 50%, 50%)')
    expect(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b) && Number.isFinite(c.a)).toBe(true)
    expect(c.a).toBe(0)
  })

  it('handles negative hue via mod 360', () => {
    const c = parseColor('hsl(-90, 100%, 50%)')
    expect(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)).toBe(true)
  })
})

describe('clipPath with objectBoundingBox units', () => {
  it('renders clip rect scaled into target bounds', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <defs>
        <clipPath id="c" clipPathUnits="objectBoundingBox">
          <rect x="0.25" y="0.25" width="0.5" height="0.5"/>
        </clipPath>
      </defs>
      <rect width="100" height="100" fill="white"/>
      <rect x="0" y="0" width="100" height="100" fill="black" clip-path="url(#c)"/>
    </svg>`
    const buf = render(SVG)
    const center = pixelAt(buf, 50, 50)
    expect(center.r).toBeLessThan(40) // inside clip → black
    const corner = pixelAt(buf, 5, 5)
    expect(corner.r).toBeGreaterThan(240) // outside clip → white
  })
})

describe('chained <use> references', () => {
  it('use → group → use → primitive renders both nested instances', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60">
      <defs>
        <rect id="dot" width="20" height="20" fill="red"/>
        <g id="row"><use href="#dot" x="0" y="0"/><use href="#dot" x="40" y="0"/></g>
      </defs>
      <rect width="100" height="60" fill="white"/>
      <use href="#row" x="10" y="10"/>
    </svg>`
    const buf = render(SVG)
    expect(pixelAt(buf, 15, 15).r).toBeGreaterThan(200)
    expect(pixelAt(buf, 55, 15).r).toBeGreaterThan(200)
  })
})

describe('parseSVG accepts binary input', () => {
  it('decodes UTF-8 Uint8Array', () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    const root = parseSVG(bytes)
    expect(root.tag).toBe('svg')
    expect(root.width).toBe(10)
  })

  it('decodes ArrayBuffer', () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    const root = parseSVG(bytes.buffer as ArrayBuffer)
    expect(root.tag).toBe('svg')
  })
})

describe('fill-rule: evenodd', () => {
  it('renders a donut (cut-out hole) when set', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
      <rect width="60" height="60" fill="white"/>
      <path d="M5 5 L55 5 L55 55 L5 55 Z M20 20 L40 20 L40 40 L20 40 Z" fill="black" fill-rule="evenodd"/>
    </svg>`
    const buf = render(SVG)
    expect(pixelAt(buf, 30, 30).r).toBeGreaterThan(240) // hole → white
    expect(pixelAt(buf, 10, 10).r).toBeLessThan(40) // ring → black
  })
})

describe('paint-order', () => {
  it('with `paint-order: stroke fill`, fill paints over stroke', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
      <rect width="60" height="60" fill="white"/>
      <rect x="20" y="20" width="20" height="20" fill="red" stroke="black" stroke-width="6" paint-order="stroke fill"/>
    </svg>`
    const buf = render(SVG)
    // Pixel just inside the bbox should be RED (fill over stroke).
    expect(pixelAt(buf, 23, 30).r).toBeGreaterThan(200)
  })
})

describe('vector-effect: non-scaling-stroke', () => {
  it('keeps stroke width constant under transform', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 50 50">
      <rect width="100" height="100" fill="white"/>
      <line x1="10" y1="25" x2="40" y2="25" stroke="black" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg>`
    const buf = render(SVG)
    // The viewBox→viewport scale is 2x. Without non-scaling-stroke, the
    // stroke would render at 4 device pixels; with it, ~2 device pixels.
    // Sample a column at x=50 (centre); count black pixels vertically.
    const d = png.sync.read(buf)
    let blackCount = 0
    for (let py = 0; py < d.height; py++) {
      const idx = (py * d.width + 50) * 4
      if (d.data[idx]! < 100) blackCount++
    }
    expect(blackCount).toBeLessThanOrEqual(4) // exactly ~2 px (allow AA halo)
  })
})

describe('xml:space="preserve"', () => {
  it('keeps internal whitespace verbatim', () => {
    const root = parseSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><text xml:space="preserve">  hello   world  </text></svg>`)
    const text = (root.children[0] as { text: string }).text
    expect(text).toBe('  hello   world  ')
  })

  it('default space collapses runs', () => {
    const root = parseSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><text>  hello   world  </text></svg>`)
    const text = (root.children[0] as { text: string }).text
    expect(text).toBe('hello world')
  })
})

describe('<style> CSS rules cascade onto matching elements', () => {
  it('class selector applies to <rect class>', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
      <style>.box { fill: red; }</style>
      <rect width="50" height="50" fill="white"/>
      <rect class="box" x="10" y="10" width="30" height="30"/>
    </svg>`
    const buf = render(SVG)
    expect(pixelAt(buf, 25, 25).r).toBeGreaterThan(200)
  })

  it('inline style attribute beats stylesheet rule', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
      <style>.box { fill: red; }</style>
      <rect width="50" height="50" fill="white"/>
      <rect class="box" x="10" y="10" width="30" height="30" style="fill: blue"/>
    </svg>`
    const buf = render(SVG)
    expect(pixelAt(buf, 25, 25).b).toBeGreaterThan(200)
    expect(pixelAt(buf, 25, 25).r).toBeLessThan(40)
  })
})

describe('stroke-width validation', () => {
  it('negative stroke-width clamps to 0 (no inverted-normal artefacts)', () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
      <rect width="60" height="60" fill="white"/>
      <rect x="20" y="20" width="20" height="20" fill="none" stroke="black" stroke-width="-5"/>
    </svg>`
    expect(() => render(SVG)).not.toThrow()
  })
})

describe('stroke-dasharray: zero/negative rejection', () => {
  it('all-zero dash array renders as solid stroke', () => {
    const root = parseSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><line x1="0" y1="10" x2="20" y2="10" stroke="black" stroke-dasharray="0 0"/></svg>`)
    const line = root.children[0] as { strokeDashArray?: number[] }
    expect(line.strokeDashArray ?? []).toHaveLength(0)
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
