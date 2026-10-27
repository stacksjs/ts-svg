import { expect, test } from 'bun:test'
import { parseSVG, rasterize } from '../src'

test('magnified paths and ellipses stay round in root and nested viewports', () => {
  const shapes = [
    '<circle cx="8" cy="8" r="6" fill="white"/>',
    '<path d="M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2Z" fill="white"/>',
  ]
  for (const shape of shapes) {
    for (const nested of [false, true]) {
      const source = nested
        ? `<svg width="512" height="512"><svg width="512" height="512" viewBox="0 0 16 16">${shape}</svg></svg>`
        : `<svg width="16" height="16" viewBox="0 0 16 16">${shape}</svg>`
      const output = rasterize(parseSVG(source), { width: 512, height: 512 })
      let missingInsideCircle = 0
      for (let angle = 0; angle < 360; angle += 3) {
        const radians = angle * Math.PI / 180
        const x = Math.round(255.5 + 190 * Math.cos(radians))
        const y = Math.round(255.5 + 190 * Math.sin(radians))
        if (output.data[(y * 512 + x) * 4 + 3]! < 240) missingInsideCircle++
      }
      expect(missingInsideCircle).toBe(0)
    }
  }
})
