/**
 * Run SVGO's per-plugin regression fixtures against ts-svg's optimize().
 *
 * Each `.svg.txt` fixture has the shape:
 *
 *     [description] (optional, before `===`)
 *     ===
 *     <input svg>
 *     @@@
 *     <expected output svg>
 *     @@@
 *     {plugin params JSON} (optional)
 *
 * If `SVGO_FIXTURES_DIR` is not present (e.g., the SVGO repo isn't on this
 * machine), the suite is skipped — these tests are exploratory rather than
 * gating the release of ts-svg.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { optimize } from '../src/optimize'

const FIXTURES_DIR = process.env.SVGO_FIXTURES_DIR || '/Users/chrisbreuer/Code/svgo/test/plugins'

const fixtureRe = /^(.*)\.(\d+)\.svg\.txt$/

function loadFixtures(): Array<{ file: string, name: string, index: string }> {
  if (!existsSync(FIXTURES_DIR) || !statSync(FIXTURES_DIR).isDirectory())
    return []
  return readdirSync(FIXTURES_DIR)
    .map((f) => {
      const m = fixtureRe.exec(f)
      return m ? { file: join(FIXTURES_DIR, f), name: m[1]!, index: m[2]! } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

function normalize(s: string): string {
  // strip trailing whitespace per line + final newline
  return s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim()
}

function parseFixture(text: string): { input: string, expected: string, params: any } {
  // Optional description before ===, then input @@@ expected @@@ params
  const items = text.split(/\s*===\s*/)
  const body = items.length === 2 ? items[1]! : items[0]!
  const parts = body.split(/\s*@@@\s*/)
  const [original, should, params] = parts
  return {
    input: original ?? '',
    expected: should ?? '',
    params: params ? JSON.parse(params) : {},
  }
}

const fixtures = loadFixtures()
const groupedByPlugin = new Map<string, Array<typeof fixtures[number]>>()
for (const f of fixtures) {
  let arr = groupedByPlugin.get(f.name)
  if (!arr) {
    arr = []
    groupedByPlugin.set(f.name, arr)
  }
  arr.push(f)
}

describe.skipIf(fixtures.length === 0)('SVGO regression fixtures', () => {
  describe('summary', () => {
    it('reports pass/fail rates per plugin', () => {
      const stats = new Map<string, { pass: number, fail: number, error: number }>()
      for (const [plugin, list] of groupedByPlugin) {
        const s = { pass: 0, fail: 0, error: 0 }
        stats.set(plugin, s)
        for (const f of list) {
          let parsed: ReturnType<typeof parseFixture>
          try {
            parsed = parseFixture(readFileSync(f.file, 'utf8'))
          }
          catch {
            s.error++
            continue
          }
          try {
            const out = optimize(parsed.input, {
              path: f.file,
              plugins: [{ name: plugin, params: parsed.params }],
              js2svg: { pretty: true } as any,
            }).data
            if (normalize(out) === normalize(parsed.expected))
              s.pass++
            else
              s.fail++
          }
          catch {
            s.error++
          }
        }
      }
      const rows = [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      const total = { pass: 0, fail: 0, error: 0 }
      // eslint-disable-next-line no-console
      console.log()
      // eslint-disable-next-line no-console
      console.log('plugin                          pass  fail error')
      // eslint-disable-next-line no-console
      console.log('-'.repeat(55))
      for (const [name, s] of rows) {
        total.pass += s.pass
        total.fail += s.fail
        total.error += s.error
        // eslint-disable-next-line no-console
        console.log(`${name.padEnd(32)}${String(s.pass).padStart(4)}  ${String(s.fail).padStart(4)}  ${String(s.error).padStart(4)}`)
      }
      // eslint-disable-next-line no-console
      console.log('-'.repeat(55))
      // eslint-disable-next-line no-console
      console.log(`${'TOTAL'.padEnd(32)}${String(total.pass).padStart(4)}  ${String(total.fail).padStart(4)}  ${String(total.error).padStart(4)}`)
      // eslint-disable-next-line no-console
      console.log()
      const totalCases = total.pass + total.fail + total.error
      // sanity floor — we should pass at least *something*
      expect(total.pass).toBeGreaterThan(0)
      expect(totalCases).toBeGreaterThan(50)
    })
  })
})
