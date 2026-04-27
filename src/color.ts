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

function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))) }

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
  if (input == null) return { ...TRANSPARENT }
  const s = input.trim().toLowerCase()
  if (s === 'none' || s === 'transparent') return { ...TRANSPARENT }
  if (s === 'currentcolor') return { ...(currentColor ?? BLACK) }

  if (s.startsWith('#')) {
    const hex = s.slice(1)
    let r = 0, g = 0, b = 0, a = 255
    if (hex.length === 3 || hex.length === 4) {
      r = Number.parseInt(hex[0]! + hex[0], 16)
      g = Number.parseInt(hex[1]! + hex[1], 16)
      b = Number.parseInt(hex[2]! + hex[2], 16)
      if (hex.length === 4) a = Number.parseInt(hex[3]! + hex[3], 16)
    }
    else if (hex.length === 6 || hex.length === 8) {
      r = Number.parseInt(hex.slice(0, 2), 16)
      g = Number.parseInt(hex.slice(2, 4), 16)
      b = Number.parseInt(hex.slice(4, 6), 16)
      if (hex.length === 8) a = Number.parseInt(hex.slice(6, 8), 16)
    }
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp255(a) }
  }

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
    const h = Number.parseFloat(parts[0] ?? '0') % 360
    const sV = Number.parseFloat((parts[1] ?? '0').replace('%', '')) / 100
    const l = Number.parseFloat((parts[2] ?? '0').replace('%', '')) / 100
    const a = parts.length >= 4
      ? (parts[3]!.endsWith('%')
          ? Number.parseFloat(parts[3]!.slice(0, -1)) / 100
          : Number.parseFloat(parts[3]!)) * 255
      : 255
    const [r, g, b] = hslToRgb((h + 360) % 360, Math.max(0, Math.min(1, sV)), Math.max(0, Math.min(1, l)))
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp255(a) }
  }

  if (s in NAMED) {
    const [r, g, b] = NAMED[s]!
    return { r, g, b, a: 255 }
  }

  return { ...TRANSPARENT }
}
