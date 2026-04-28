// Generates a path-heavy SVG (single huge `d` attribute) for parser stress testing.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const W = 1024
const H = 1024
let seed = 42
const rand = (): number => {
  seed = (seed * 1103515245 + 12345) | 0
  return ((seed >>> 0) % 100000) / 100000
}

const segs: string[] = ['M0 0']
for (let i = 0; i < 4000; i++) {
  const op = rand()
  const x = (rand() * W).toFixed(2)
  const y = (rand() * H).toFixed(2)
  if (op < 0.5) segs.push(`L${x} ${y}`)
  else if (op < 0.8) {
    const cx1 = (rand() * W).toFixed(1)
    const cy1 = (rand() * H).toFixed(1)
    const cx2 = (rand() * W).toFixed(1)
    const cy2 = (rand() * H).toFixed(1)
    segs.push(`C${cx1} ${cy1} ${cx2} ${cy2} ${x} ${y}`)
  }
  else if (op < 0.9) {
    const cx = (rand() * W).toFixed(1)
    const cy = (rand() * H).toFixed(1)
    segs.push(`Q${cx} ${cy} ${x} ${y}`)
  }
  else {
    segs.push(`M${x} ${y}`)
  }
}
segs.push('Z')
const d = segs.join(' ')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#101218"/>
  <path d="${d}" fill="none" stroke="#7df" stroke-width="0.6" opacity="0.7"/>
</svg>`

writeFileSync(join(import.meta.dir, 'path-heavy.svg'), svg)
console.log(`wrote path-heavy.svg (${svg.length} chars)`)
