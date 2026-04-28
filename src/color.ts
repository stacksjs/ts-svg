/**
 * CSS / SVG color parser.
 *
 * Recognises:
 *   - `none`, `currentColor`, `transparent`
 *   - `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`
 *   - `rgb(r,g,b)`, `rgba(r,g,b,a)` — values 0..255 (or 0..100% with `%`),
 *     alpha 0..1
 *   - `hsl(h,s%,l%)` and `hsla(h,s%,l%,a)`
 *   - 147 named CSS colours
 */

import type { RGBA } from './types'

export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 }
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 }
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 }

const NAMED: Record<string, [number, number, number]> = {
  aliceblue: [240, 248, 255], antiquewhite: [250, 235, 215], aqua: [0, 255, 255],
  aquamarine: [127, 255, 212], azure: [240, 255, 255], beige: [245, 245, 220],
  bisque: [255, 228, 196], black: [0, 0, 0], blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255], blueviolet: [138, 43, 226], brown: [165, 42, 42],
  burlywood: [222, 184, 135], cadetblue: [95, 158, 160], chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30], coral: [255, 127, 80], cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220], crimson: [220, 20, 60], cyan: [0, 255, 255],
  darkblue: [0, 0, 139], darkcyan: [0, 139, 139], darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169], darkgreen: [0, 100, 0], darkgrey: [169, 169, 169],
  darkkhaki: [189, 183, 107], darkmagenta: [139, 0, 139], darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0], darkorchid: [153, 50, 204], darkred: [139, 0, 0],
  darksalmon: [233, 150, 122], darkseagreen: [143, 188, 143], darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79], darkslategrey: [47, 79, 79], darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211], deeppink: [255, 20, 147], deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105], dimgrey: [105, 105, 105], dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34], floralwhite: [255, 250, 240], forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255], gainsboro: [220, 220, 220], ghostwhite: [248, 248, 255],
  gold: [255, 215, 0], goldenrod: [218, 165, 32], gray: [128, 128, 128],
  green: [0, 128, 0], greenyellow: [173, 255, 47], grey: [128, 128, 128],
  honeydew: [240, 255, 240], hotpink: [255, 105, 180], indianred: [205, 92, 92],
  indigo: [75, 0, 130], ivory: [255, 255, 240], khaki: [240, 230, 140],
  lavender: [230, 230, 250], lavenderblush: [255, 240, 245], lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205], lightblue: [173, 216, 230], lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255], lightgoldenrodyellow: [250, 250, 210], lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144], lightgrey: [211, 211, 211], lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122], lightseagreen: [32, 178, 170], lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153], lightslategrey: [119, 136, 153], lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224], lime: [0, 255, 0], limegreen: [50, 205, 50],
  linen: [250, 240, 230], magenta: [255, 0, 255], maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170], mediumblue: [0, 0, 205], mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219], mediumseagreen: [60, 179, 113], mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154], mediumturquoise: [72, 209, 204], mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112], mintcream: [245, 255, 250], mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181], navajowhite: [255, 222, 173], navy: [0, 0, 128],
  oldlace: [253, 245, 230], olive: [128, 128, 0], olivedrab: [107, 142, 35],
  orange: [255, 165, 0], orangered: [255, 69, 0], orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170], palegreen: [152, 251, 152], paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147], papayawhip: [255, 239, 213], peachpuff: [255, 218, 185],
  peru: [205, 133, 63], pink: [255, 192, 203], plum: [221, 160, 221],
  powderblue: [176, 224, 230], purple: [128, 0, 128], rebeccapurple: [102, 51, 153],
  red: [255, 0, 0], rosybrown: [188, 143, 143], royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19], salmon: [250, 128, 114], sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87], seashell: [255, 245, 238], sienna: [160, 82, 45],
  silver: [192, 192, 192], skyblue: [135, 206, 235], slateblue: [106, 90, 205],
  slategray: [112, 128, 144], slategrey: [112, 128, 144], snow: [255, 250, 250],
  springgreen: [0, 255, 127], steelblue: [70, 130, 180], tan: [210, 180, 140],
  teal: [0, 128, 128], thistle: [216, 191, 216], tomato: [255, 99, 71],
  turquoise: [64, 224, 208], violet: [238, 130, 238], wheat: [245, 222, 179],
  white: [255, 255, 255], whitesmoke: [245, 245, 245], yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
}

/** Pre-built Map for O(1) lookup. Object property access is fast in V8 too,
 *  but `Map.get` is consistently slightly faster and gives stable timings. */
const NAMED_MAP = new Map<string, [number, number, number]>(Object.entries(NAMED))

function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))) }

// Fast inline hex digit → 0..15. Returns -1 for non-hex.
function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48 // 0-9
  if (code >= 97 && code <= 102) return code - 87 // a-f
  if (code >= 65 && code <= 70) return code - 55 // A-F
  return -1
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // h in [0, 360), s/l in [0, 1]
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r1 = 0, g1 = 0, b1 = 0
  if (h < 60) { r1 = c; g1 = x; b1 = 0 }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0 }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]
}

/**
 * Parse a CSS / SVG colour string into an RGBA. Returns transparent black on
 * failure. If `currentColor` is supplied, it overrides the resolution of the
 * `currentColor` keyword (which would otherwise default to black).
 *
 * Always returns a fresh object — callers may mutate the result (e.g. apply
 * stop-opacity) without affecting `BLACK` / `TRANSPARENT` / shared constants.
 */
export function parseColor(input: string | null | undefined, currentColor?: RGBA): RGBA {
  if (input == null) return { r: 0, g: 0, b: 0, a: 0 }
  // Fast hex path — by far the most common shape (#rgb, #rrggbb). Avoid
  // .trim().toLowerCase() allocation when the input is already a tight hex.
  if (input.length > 0 && input.charCodeAt(0) === 35 /* # */) {
    const len = input.length - 1
    if (len === 3 || len === 6 || len === 4 || len === 8) {
      let r = 0, g = 0, b = 0, a = 255
      if (len === 3 || len === 4) {
        const r4 = hexNibble(input.charCodeAt(1))
        const g4 = hexNibble(input.charCodeAt(2))
        const b4 = hexNibble(input.charCodeAt(3))
        if (r4 < 0 || g4 < 0 || b4 < 0) return { r: 0, g: 0, b: 0, a: 0 }
        r = r4 * 17; g = g4 * 17; b = b4 * 17
        if (len === 4) {
          const a4 = hexNibble(input.charCodeAt(4))
          if (a4 < 0) return { r: 0, g: 0, b: 0, a: 0 }
          a = a4 * 17
        }
      }
      else {
        const r1 = hexNibble(input.charCodeAt(1)), r2 = hexNibble(input.charCodeAt(2))
        const g1 = hexNibble(input.charCodeAt(3)), g2 = hexNibble(input.charCodeAt(4))
        const b1 = hexNibble(input.charCodeAt(5)), b2 = hexNibble(input.charCodeAt(6))
        if (r1 < 0 || r2 < 0 || g1 < 0 || g2 < 0 || b1 < 0 || b2 < 0) return { r: 0, g: 0, b: 0, a: 0 }
        r = (r1 << 4) | r2; g = (g1 << 4) | g2; b = (b1 << 4) | b2
        if (len === 8) {
          const a1 = hexNibble(input.charCodeAt(7)), a2 = hexNibble(input.charCodeAt(8))
          if (a1 < 0 || a2 < 0) return { r: 0, g: 0, b: 0, a: 0 }
          a = (a1 << 4) | a2
        }
      }
      return { r, g, b, a }
    }
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const s = input.trim().toLowerCase()
  if (s === 'none' || s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s === 'currentcolor') return currentColor ? { r: currentColor.r, g: currentColor.g, b: currentColor.b, a: currentColor.a } : { r: 0, g: 0, b: 0, a: 255 }

  const rgbm = s.match(/^rgba?\s*\(([^)]+)\)$/)
  if (rgbm) {
    const parts = rgbm[1]!.split(/[\s,/]+/).filter(Boolean)
    // Channels: "0..255" or "0..100%". Alpha: "0..1" or "0..100%".
    const parseChannel = (v: string): number => v.endsWith('%')
      ? (Number.parseFloat(v.slice(0, -1)) / 100) * 255
      : Number.parseFloat(v)
    const parseAlpha = (v: string): number => v.endsWith('%')
      ? (Number.parseFloat(v.slice(0, -1)) / 100) * 255
      : Number.parseFloat(v) * 255
    const r = parseChannel(parts[0] ?? '0')
    const g = parseChannel(parts[1] ?? '0')
    const b = parseChannel(parts[2] ?? '0')
    const a = parts.length >= 4 ? parseAlpha(parts[3]!) : 255
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp255(a) }
  }

  const hslm = s.match(/^hsla?\s*\(([^)]+)\)$/)
  if (hslm) {
    const parts = hslm[1]!.split(/[\s,/]+/).filter(Boolean)
    const hRaw = Number.parseFloat(parts[0] ?? '0')
    const sRaw = Number.parseFloat((parts[1] ?? '0').replace('%', '')) / 100
    const lRaw = Number.parseFloat((parts[2] ?? '0').replace('%', '')) / 100
    // Reject any NaN component before doing arithmetic — NaN propagates
    // silently through `Math.cos`/`% 360` and ends up baking NaN bytes into
    // the framebuffer, where they dim the image and corrupt blends.
    if (!Number.isFinite(hRaw) || !Number.isFinite(sRaw) || !Number.isFinite(lRaw)) {
      return { r: 0, g: 0, b: 0, a: 0 }
    }
    const a = parts.length >= 4
      ? (parts[3]!.endsWith('%')
          ? Number.parseFloat(parts[3]!.slice(0, -1)) / 100
          : Number.parseFloat(parts[3]!)) * 255
      : 255
    const h = ((hRaw % 360) + 360) % 360
    const [r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, sRaw)), Math.max(0, Math.min(1, lRaw)))
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp255(Number.isFinite(a) ? a : 255) }
  }

  const named = NAMED_MAP.get(s)
  if (named) return { r: named[0], g: named[1], b: named[2], a: 255 }

  return { r: 0, g: 0, b: 0, a: 0 }
}
