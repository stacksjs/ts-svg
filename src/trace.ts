/**
 * Raster-to-SVG tracing.
 *
 * Pure-TypeScript replacement for shelling out to potrace. The algorithm
 * is intentionally simple — run-length-encode per row, emit one path
 * segment per horizontal run — so the output is verbose compared to
 * curve-fitting tracers but always valid, deterministic, and cheap to
 * compute. For pixel-art and quantized inputs the output is competitive;
 * for photographs it is large and should be passed through `optimize()`
 * (or skipped in favour of leaving the image as a raster).
 *
 * Modes:
 *   - `bw`         — luminance threshold to 1 bit, single path of "on" pixels
 *   - `grayscale`  — quantize to N gray levels, one path per level
 *   - `color`      — quantize to N most-frequent colours, one path per colour
 *   - `posterized` — round each channel to `steps` levels, one path per
 *                    resulting unique colour
 */

export interface TraceImageInput {
  /** RGBA pixel data, 4 bytes per pixel, row-major. */
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

export interface TraceImageOptions {
  /**
   * Tracing mode. Defaults to `'color'`.
   * - `bw` produces a single black path against a transparent background.
   * - `grayscale` and `color` emit one path per quantized level.
   * - `posterized` rounds each channel to `steps` steps and traces the
   *   resulting palette.
   */
  mode?: 'bw' | 'grayscale' | 'color' | 'posterized'
  /** Luminance threshold (0..255) for `bw` mode. Default 128. */
  threshold?: number
  /** Palette size for `color` mode. Default 16. Capped at 256. */
  colorCount?: number
  /** Levels per channel for `posterized` mode. Default 4. */
  steps?: number
  /** Optional fixed background colour for the SVG (any valid CSS color). */
  background?: string
  /** Optional fill for the `bw` mode path. Default `'black'`. */
  bwFill?: string
  /** When true, omit the XML declaration and a few attributes. Default false. */
  minify?: boolean
}

export interface TraceImageResult {
  svg: string
  width: number
  height: number
}

const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

function luminance(r: number, g: number, b: number): number {
  return Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b)
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (1 << 24) | (r << 16) | (g << 8) | b
  return `#${h.toString(16).slice(1)}`
}

function colorKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

/**
 * Walk each row of a binary mask, emit one `M x y h w v 1 h -w Z` path
 * fragment per horizontal run of "on" pixels. Returns a single `d`
 * attribute string covering every run.
 */
function maskToPathD(mask: Uint8Array, width: number, height: number): string {
  const parts: string[] = []
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      // Skip "off" pixels.
      while (x < width && mask[y * width + x] === 0) x++
      if (x >= width) break
      const start = x
      while (x < width && mask[y * width + x] === 1) x++
      const len = x - start
      // Compact rectangle subpath. Each run becomes an axis-aligned
      // 1-row-tall rectangle. SVG path fill-rule defaults to nonzero,
      // which is fine for non-overlapping rects.
      parts.push(`M${start} ${y}h${len}v1h-${len}Z`)
    }
  }
  return parts.join('')
}

function buildBwMask(input: TraceImageInput, threshold: number): Uint8Array {
  const { data, width, height } = input
  const mask = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Treat fully-transparent pixels as background regardless of luma.
    if (data[i + 3] === 0) { mask[p] = 0; continue }
    mask[p] = luminance(data[i], data[i + 1], data[i + 2]) < threshold ? 1 : 0
  }
  return mask
}

function quantizePosterized(input: TraceImageInput, steps: number): Map<number, Uint8Array> {
  const { data, width, height } = input
  const buckets = new Map<number, Uint8Array>()
  // Round each channel to one of `steps` evenly-spaced values.
  const stepSize = 255 / Math.max(1, steps - 1)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue
    const r = Math.round(Math.round(data[i] / stepSize) * stepSize)
    const g = Math.round(Math.round(data[i + 1] / stepSize) * stepSize)
    const b = Math.round(Math.round(data[i + 2] / stepSize) * stepSize)
    const key = colorKey(r, g, b)
    let mask = buckets.get(key)
    if (!mask) {
      mask = new Uint8Array(width * height)
      buckets.set(key, mask)
    }
    mask[p] = 1
  }
  return buckets
}

function quantizeGrayscale(input: TraceImageInput, levels: number): Map<number, Uint8Array> {
  const { data, width, height } = input
  const buckets = new Map<number, Uint8Array>()
  const stepSize = 255 / Math.max(1, levels - 1)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue
    const y = luminance(data[i], data[i + 1], data[i + 2])
    const v = Math.round(Math.round(y / stepSize) * stepSize)
    const key = colorKey(v, v, v)
    let mask = buckets.get(key)
    if (!mask) {
      mask = new Uint8Array(width * height)
      buckets.set(key, mask)
    }
    mask[p] = 1
  }
  return buckets
}

function quantizeColor(input: TraceImageInput, colorCount: number): Map<number, Uint8Array> {
  const { data, width, height } = input
  // Two-pass: first build a 6×6×6 histogram (as a rough median-cut
  // substitute), then map each pixel to the most common bucket inside
  // its cube cell. 216 colour buckets is enough resolution to keep
  // posterization-grade tracing usable while staying O(n) in pixels.
  const cubeBins = 6
  const histogram = new Uint32Array(cubeBins * cubeBins * cubeBins)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const ri = Math.min(cubeBins - 1, Math.floor(data[i] * cubeBins / 256))
    const gi = Math.min(cubeBins - 1, Math.floor(data[i + 1] * cubeBins / 256))
    const bi = Math.min(cubeBins - 1, Math.floor(data[i + 2] * cubeBins / 256))
    histogram[ri * cubeBins * cubeBins + gi * cubeBins + bi]++
  }

  // Pick the top `colorCount` buckets by frequency. For each chosen
  // bucket, the colour we emit is the cube cell's centre.
  const cells: Array<{ idx: number, count: number }> = []
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > 0) cells.push({ idx: i, count: histogram[i] })
  }
  cells.sort((a, b) => b.count - a.count)
  const palette: Array<{ key: number, r: number, g: number, b: number }> = []
  const cap = Math.min(colorCount, 256, cells.length)
  for (let i = 0; i < cap; i++) {
    const idx = cells[i].idx
    const ri = Math.floor(idx / (cubeBins * cubeBins))
    const gi = Math.floor((idx / cubeBins) % cubeBins)
    const bi = idx % cubeBins
    const r = Math.round((ri + 0.5) * 256 / cubeBins)
    const g = Math.round((gi + 0.5) * 256 / cubeBins)
    const b = Math.round((bi + 0.5) * 256 / cubeBins)
    palette.push({ key: colorKey(r, g, b), r, g, b })
  }

  // Map each pixel to the nearest palette entry by squared distance.
  const buckets = new Map<number, Uint8Array>()
  for (const c of palette) buckets.set(c.key, new Uint8Array(width * height))
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    let bestKey = palette[0].key
    let bestDist = Number.POSITIVE_INFINITY
    for (let j = 0; j < palette.length; j++) {
      const dr = r - palette[j].r
      const dg = g - palette[j].g
      const db = b - palette[j].b
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        bestKey = palette[j].key
      }
    }
    buckets.get(bestKey)![p] = 1
  }
  return buckets
}

/**
 * Trace raster pixel data to an SVG document.
 */
export function traceImage(input: TraceImageInput, options: TraceImageOptions = {}): TraceImageResult {
  const { width, height } = input
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('ts-svg: traceImage requires positive integer width and height')
  if (input.data.length < width * height * 4)
    throw new Error('ts-svg: traceImage data buffer is too small for the given dimensions')

  const {
    mode = 'color',
    threshold = 128,
    colorCount = 16,
    steps = 4,
    background,
    bwFill = 'black',
  } = options

  const bgRect = background ? `<rect width="100%" height="100%" fill="${background}"/>` : ''
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  const close = '</svg>'

  if (mode === 'bw') {
    const mask = buildBwMask(input, threshold)
    const d = maskToPathD(mask, width, height)
    const path = `<path fill="${bwFill}" d="${d}"/>`
    return { svg: `${open}${bgRect}${path}${close}`, width, height }
  }

  let buckets: Map<number, Uint8Array>
  if (mode === 'posterized') buckets = quantizePosterized(input, steps)
  else if (mode === 'grayscale') buckets = quantizeGrayscale(input, Math.max(2, steps))
  else buckets = quantizeColor(input, colorCount)

  // Emit paths in deterministic order (largest area first reduces visual
  // overdraw flicker in viewers that paint progressively).
  const entries = Array.from(buckets.entries()).map(([key, mask]) => {
    let count = 0
    for (let i = 0; i < mask.length; i++) count += mask[i]
    return { key, mask, count }
  })
  entries.sort((a, b) => b.count - a.count)

  const paths: string[] = []
  for (const { key, mask } of entries) {
    const d = maskToPathD(mask, width, height)
    if (!d) continue
    const r = (key >> 16) & 0xFF
    const g = (key >> 8) & 0xFF
    const b = key & 0xFF
    paths.push(`<path fill="${rgbToHex(r, g, b)}" d="${d}"/>`)
  }

  return { svg: `${open}${bgRect}${paths.join('')}${close}`, width, height }
}
