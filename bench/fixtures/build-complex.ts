// Generates a "complex" SVG with hundreds of decorative shapes.
// Run with `bun bench/fixtures/build-complex.ts` once; commit the output.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const W = 800
const H = 600
const out: string[] = []
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
out.push(`  <defs>`)
out.push(`    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">`)
out.push(`      <stop offset="0" stop-color="#0a0a23"/>`)
out.push(`      <stop offset="1" stop-color="#1f3b9b"/>`)
out.push(`    </linearGradient>`)
out.push(`    <radialGradient id="g2" cx="0.5" cy="0.5" r="0.7">`)
out.push(`      <stop offset="0" stop-color="#ffe27a"/>`)
out.push(`      <stop offset="1" stop-color="#ff5f6d"/>`)
out.push(`    </radialGradient>`)
out.push(`  </defs>`)
out.push(`  <rect width="${W}" height="${H}" fill="url(#g1)"/>`)

// Deterministic pseudo-random
let seed = 1
const rand = (): number => {
  seed = (seed * 1664525 + 1013904223) | 0
  return ((seed >>> 0) % 100000) / 100000
}

// 200 small star paths
for (let i = 0; i < 200; i++) {
  const cx = rand() * W
  const cy = rand() * H
  const r = 1 + rand() * 2.2
  out.push(`  <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.4 + rand() * 0.6).toFixed(2)}"/>`)
}

// 80 styled paths (cubic bezier waves)
for (let i = 0; i < 80; i++) {
  const x0 = rand() * W
  const y0 = rand() * H
  const x1 = x0 + 60 + rand() * 80
  const y1 = y0 - 40 + rand() * 80
  const cx1 = x0 + 30, cy1 = y0 - 50
  const cx2 = x1 - 30, cy2 = y1 + 50
  const w = 1 + rand() * 2.5
  const hue = Math.floor(rand() * 360)
  out.push(`  <path d="M${x0.toFixed(1)} ${y0.toFixed(1)} C${cx1.toFixed(1)} ${cy1.toFixed(1)} ${cx2.toFixed(1)} ${cy2.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="hsl(${hue} 80% 60%)" stroke-width="${w.toFixed(2)}" fill="none" opacity="0.65"/>`)
}

// 60 rotated rectangles
for (let i = 0; i < 60; i++) {
  const x = rand() * W
  const y = rand() * H
  const w = 10 + rand() * 30
  const h = 10 + rand() * 30
  const rot = (rand() * 360).toFixed(1)
  out.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" transform="rotate(${rot} ${(x + w / 2).toFixed(1)} ${(y + h / 2).toFixed(1)})" fill="url(#g2)" opacity="0.55"/>`)
}

// 1 big focal blob
out.push(`  <g transform="translate(${W / 2} ${H / 2})">`)
out.push(`    <circle r="120" fill="url(#g2)" opacity="0.85"/>`)
out.push(`    <circle r="80" fill="#0a0a23" opacity="0.6"/>`)
out.push(`    <path d="M-60 0 Q0 -60 60 0 Q0 60 -60 0 Z" fill="#ffe27a"/>`)
out.push(`  </g>`)

// Deeply nested group with shared style
let nested = `  <g fill="none" stroke="#fff" stroke-width="1.2" opacity="0.35">`
for (let i = 0; i < 20; i++) {
  nested += `<g transform="rotate(${i * 18} ${W / 2} ${H / 2})">`
  nested += `<line x1="${W / 2 - 200}" y1="${H / 2}" x2="${W / 2 + 200}" y2="${H / 2}"/>`
  nested += `</g>`
}
nested += `</g>`
out.push(nested)

out.push(`</svg>`)

writeFileSync(join(import.meta.dir, 'complex.svg'), out.join('\n'))
console.log(`wrote complex.svg (${out.length} lines)`)
