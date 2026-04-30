import { describe, expect, it } from 'bun:test'
import { traceImage } from '../src/trace'

function pixel(rgba: number[]): Uint8Array {
  return new Uint8Array(rgba)
}

function image(width: number, height: number, build: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const c = build(x, y)
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = c[3]
    }
  }
  return data
}

describe('traceImage', () => {
  it('produces a valid <svg> wrapper with the right dimensions', () => {
    const data = pixel([0, 0, 0, 255])
    const result = traceImage({ data, width: 1, height: 1 }, { mode: 'bw' })
    expect(result.svg.startsWith('<svg')).toBe(true)
    expect(result.svg.endsWith('</svg>')).toBe(true)
    expect(result.svg).toContain('viewBox="0 0 1 1"')
    expect(result.svg).toContain('width="1"')
    expect(result.svg).toContain('height="1"')
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
  })

  it('emits a single black path for a black pixel in bw mode', () => {
    const data = pixel([0, 0, 0, 255])
    const result = traceImage({ data, width: 1, height: 1 }, { mode: 'bw' })
    expect(result.svg).toContain('<path')
    expect(result.svg).toContain('fill="black"')
    expect(result.svg).toContain('d="M0 0h1v1h-1Z"')
  })

  it('skips fully-transparent pixels', () => {
    const data = pixel([0, 0, 0, 0])
    const result = traceImage({ data, width: 1, height: 1 }, { mode: 'bw' })
    // Empty mask → empty d attribute on the path.
    expect(result.svg).toContain('d=""')
  })

  it('respects the bw threshold', () => {
    // Mid-grey — depends on which side of the threshold we land on.
    const data = pixel([127, 127, 127, 255])
    const dark = traceImage({ data, width: 1, height: 1 }, { mode: 'bw', threshold: 200 })
    const light = traceImage({ data, width: 1, height: 1 }, { mode: 'bw', threshold: 100 })
    expect(dark.svg.includes('h1v1h-1Z')).toBe(true)
    expect(light.svg.includes('h1v1h-1Z')).toBe(false)
  })

  it('emits one path per quantized colour bucket in posterized mode', () => {
    // Two solid 1×2 columns with distinct colours.
    const data = image(2, 1, (x) => x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255])
    const result = traceImage({ data, width: 2, height: 1 }, { mode: 'posterized', steps: 2 })
    const paths = result.svg.match(/<path /g) || []
    expect(paths.length).toBe(2)
  })

  it('inserts a background rect when requested', () => {
    const data = pixel([0, 0, 0, 255])
    const result = traceImage({ data, width: 1, height: 1 }, { mode: 'bw', background: '#abc' })
    expect(result.svg).toContain('<rect width="100%" height="100%" fill="#abc"/>')
    // Background must come BEFORE any path so it doesn't paint over the trace.
    expect(result.svg.indexOf('<rect')).toBeLessThan(result.svg.indexOf('<path'))
  })

  it('throws when the input buffer is too small', () => {
    const data = new Uint8Array(4) // claims 2x2 but only carries 1 pixel
    expect(() => traceImage({ data, width: 2, height: 2 }, { mode: 'bw' })).toThrow()
  })

  it('emits one path per colour for color mode within the requested palette size', () => {
    // 4 unique colours; cap palette at 2 — the tracer should map them down.
    const data = image(4, 1, (x) => {
      if (x === 0) return [240, 0, 0, 255]
      if (x === 1) return [200, 0, 0, 255] // close to red — should land in red bucket
      if (x === 2) return [0, 240, 0, 255]
      return [0, 200, 0, 255] // close to green — should land in green bucket
    })
    const result = traceImage({ data, width: 4, height: 1 }, { mode: 'color', colorCount: 2 })
    const paths = result.svg.match(/<path /g) || []
    expect(paths.length).toBeLessThanOrEqual(2)
    expect(paths.length).toBeGreaterThanOrEqual(1)
  })
})
