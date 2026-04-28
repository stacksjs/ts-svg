/**
 * mitata benchmark suite for ts-svg.
 *
 * Each group is a head-to-head ts-svg vs. SVGO comparison so the winner is
 * unambiguous. The "internal" group at the end shows our two parsers
 * (renderer-side vs. xast) for context — they expose different APIs so the
 * comparison is informational, not competitive.
 *
 * Categories:
 *   1. Parsing — ts-svg `parseSvg` (xast) vs. svgo's parser (via `parseSvg`).
 *   2. Optimization — ts-svg `optimize` vs. svgo `optimize`, default plugins.
 *   3. Stringification — ts-svg `stringifySvg` vs. svgo's stringifier.
 *   4. Rendering pipeline — solo bench (no pure-TS competitor).
 *   5. Internal reference — renderer-side parseSVG, parsePath, parseTransform.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { barplot, bench, group, run, summary } from 'mitata'
import * as svgo from 'svgo'

import {
  encodePng,
  optimize as tsOptimize,
  parseColor as tsParseColor,
  parsePath as tsParsePath,
  parseSVG as tsParseSVG,
  parseTransform as tsParseTransform,
  rasterize as tsRasterize,
  svgToPng as tsSvgToPng,
} from '../src'
import { parseSvg as tsParseSvg, stringifySvg as tsStringifySvg } from '../src/optimize'

const FIX = (name: string): string => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8')

const TINY = FIX('tiny.svg')
const ICON = FIX('icon.svg')
const COMPLEX = FIX('complex.svg')
const MESSY = FIX('messy.svg')
const PATH_HEAVY = FIX('path-heavy.svg')

// Pre-parsed asts, used by the stringifier benches so we measure stringify only.
const COMPLEX_AST = tsParseSvg(COMPLEX)
const MESSY_AST = tsParseSvg(MESSY)
const PATH_HEAVY_AST = tsParseSvg(PATH_HEAVY)

const PATH_D = (() => {
  const m = PATH_HEAVY.match(/d="([^"]+)"/)
  return m ? m[1]! : 'M0 0 L100 100'
})()

const TRANSFORMS = [
  'translate(10 5) scale(2)',
  'matrix(1 0 0 1 100 50)',
  'rotate(45 200 200) translate(10,10) scale(0.5)',
  'translate(-10) rotate(15) skewX(8) translate(20 20)',
]

console.log('warming up: validating outputs are non-empty before benching...')
{
  const r1 = tsParseSVG(ICON)
  if (!r1 || r1.children.length === 0) throw new Error('ts-svg renderer parser broken')
  const r2 = svgo.optimize(MESSY)
  if (!r2.data) throw new Error('svgo broken')
  const r3 = tsOptimize(MESSY)
  if (!r3.data) throw new Error('ts-svg optimize broken')
  const r4 = tsSvgToPng(ICON)
  if (r4.byteLength < 100) throw new Error('ts-svg svgToPng broken')
  const r5 = tsStringifySvg(COMPLEX_AST)
  if (r5.length < 100) throw new Error('ts-svg stringifySvg broken')
}
console.log('outputs OK — starting benchmark suite.\n')

// ───────────────────────────────────────────────────────────────────────
// 1. PARSE — ts-svg xast parser vs. svgo's parser
// ───────────────────────────────────────────────────────────────────────
group('parse: tiny (254 B)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg parseSvg', () => tsParseSvg(TINY))
      bench('svgo parseSvg', () => svgo.optimize(TINY, { plugins: [] }))
    })
  })
})

group('parse: icon (1 KB, gradients)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg parseSvg', () => tsParseSvg(ICON))
      bench('svgo parseSvg', () => svgo.optimize(ICON, { plugins: [] }))
    })
  })
})

group('parse: complex (35 KB, ~360 nodes)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg parseSvg', () => tsParseSvg(COMPLEX))
      bench('svgo parseSvg', () => svgo.optimize(COMPLEX, { plugins: [] }))
    })
  })
})

group('parse: path-heavy (93 KB, 4k segs)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg parseSvg', () => tsParseSvg(PATH_HEAVY))
      bench('svgo parseSvg', () => svgo.optimize(PATH_HEAVY, { plugins: [] }))
    })
  })
})

// ───────────────────────────────────────────────────────────────────────
// 2. OPTIMIZE — ts-svg vs. svgo with default plugins
// ───────────────────────────────────────────────────────────────────────
group('optimize: messy (default plugins)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg optimize', () => tsOptimize(MESSY))
      bench('svgo optimize', () => svgo.optimize(MESSY))
    })
  })
})

group('optimize: complex (default plugins)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg optimize', () => tsOptimize(COMPLEX))
      bench('svgo optimize', () => svgo.optimize(COMPLEX))
    })
  })
})

group('optimize: path-heavy (default plugins)', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg optimize', () => tsOptimize(PATH_HEAVY))
      bench('svgo optimize', () => svgo.optimize(PATH_HEAVY))
    })
  })
})

// ───────────────────────────────────────────────────────────────────────
// 3. STRINGIFY — ts-svg vs. svgo (parse-then-stringify w/ no plugins is
//    a fair proxy since svgo doesn't expose stringify standalone).
// ───────────────────────────────────────────────────────────────────────
group('stringify: complex ast', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg stringifySvg', () => tsStringifySvg(COMPLEX_AST))
      bench('svgo (parse+stringify, plugins:[])', () => svgo.optimize(COMPLEX, { plugins: [] }))
    })
  })
})

group('stringify: messy ast', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg stringifySvg', () => tsStringifySvg(MESSY_AST))
      bench('svgo (parse+stringify, plugins:[])', () => svgo.optimize(MESSY, { plugins: [] }))
    })
  })
})

group('stringify: path-heavy ast', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg stringifySvg', () => tsStringifySvg(PATH_HEAVY_AST))
      bench('svgo (parse+stringify, plugins:[])', () => svgo.optimize(PATH_HEAVY, { plugins: [] }))
    })
  })
})

// ───────────────────────────────────────────────────────────────────────
// 4. RENDER PIPELINE — pure-TS, no in-tree competitor (resvg is wasm/native)
// ───────────────────────────────────────────────────────────────────────
group('rasterize: tiny → 64×64', () => {
  const root = tsParseSVG(TINY)
  summary(() => { barplot(() => { bench('ts-svg rasterize', () => tsRasterize(root)) }) })
})

group('rasterize: icon → 128×128', () => {
  const root = tsParseSVG(ICON)
  summary(() => { barplot(() => { bench('ts-svg rasterize', () => tsRasterize(root)) }) })
})

group('rasterize: complex → 800×600', () => {
  const root = tsParseSVG(COMPLEX)
  summary(() => { barplot(() => { bench('ts-svg rasterize', () => tsRasterize(root)) }) })
})

group('encodePng: 128×128 RGBA', () => {
  const fb = tsRasterize(tsParseSVG(ICON))
  summary(() => { barplot(() => { bench('ts-svg encodePng', () => encodePng(fb)) }) })
})

group('svgToPng: icon end-to-end', () => {
  summary(() => { barplot(() => { bench('ts-svg svgToPng', () => tsSvgToPng(ICON)) }) })
})

// ───────────────────────────────────────────────────────────────────────
// 5. INTERNAL REFERENCE — ts-svg helpers (no head-to-head competitor)
// ───────────────────────────────────────────────────────────────────────
group('parseSVG (renderer): icon', () => {
  summary(() => { barplot(() => { bench('ts-svg parseSVG', () => tsParseSVG(ICON)) }) })
})

group('parseSVG (renderer): complex', () => {
  summary(() => { barplot(() => { bench('ts-svg parseSVG', () => tsParseSVG(COMPLEX)) }) })
})

group('parsePath: 4k segments', () => {
  summary(() => { barplot(() => { bench('ts-svg parsePath', () => tsParsePath(PATH_D)) }) })
})

group('parseTransform: 4 forms', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg parseTransform', () => {
        for (const t of TRANSFORMS) tsParseTransform(t)
      })
    })
  })
})

const COLORS = [
  '#fff', '#abc', '#ff8800', '#0066ffaa',
  'rgb(120, 200, 80)', 'rgba(0,0,0,0.5)',
  'hsl(120, 50%, 60%)', 'red', 'cornflowerblue', 'transparent',
]
group('parseColor: 10 mixed forms', () => {
  summary(() => {
    barplot(() => {
      bench('ts-svg parseColor', () => {
        for (let i = 0; i < COLORS.length; i++) tsParseColor(COLORS[i]!)
      })
    })
  })
})

await run({ format: 'mitata' })
