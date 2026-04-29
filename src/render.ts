/**
 * Walk an SVG element tree, flatten every shape into polygons, and
 * rasterise into an RGBA framebuffer.
 */

import type { BaseNode, FontResolver, ImageResolver, Matrix, RGBA, SVGDefs, SVGElementNode, SVGImage, SVGNode, SVGPath, SVGPolygon, SVGRect, SVGRoot, SVGText, SVGUse } from './types'
import { config } from './config'
import { BLACK, parseColor } from './color'
import { buildGradientPaint, parseUrlRef, polysBBox, type PaintContext } from './paint'
import { flattenCommands, flattenCubic, parsePath } from './path'
import { createFramebuffer, fillPolygons, strokePolylines, type Framebuffer, type Paint, type StrokeStyle } from './raster'
import { IDENTITY, invertMatrix, multiply } from './transform'

export interface RenderOptions {
  /** Output width in pixels. Overrides the SVG's intrinsic width. */
  width?: number
  /** Output height in pixels. */
  height?: number
  /** Multiplier on the SVG's intrinsic size. Ignored if width/height are set. */
  scale?: number
  /** Background colour (CSS string or RGBA). Defaults to transparent. */
  background?: string | RGBA
  /** Bezier flattening tolerance in user-space units. Default 0.25 px. */
  tolerance?: number
  /** Resolves `<text>` elements to a font. If unset, text is skipped. */
  fontResolver?: FontResolver
  /** Resolves `<image href=>` to RGBA pixel data. If unset, images are skipped. */
  imageResolver?: ImageResolver
  /** Resolves `currentColor` references. Defaults to the value from svg.config.ts. */
  currentColor?: string | RGBA
  /** Maximum recursion depth for `<use>`. Defaults to the value from svg.config.ts. */
  maxUseDepth?: number
}

interface RenderCtx {
  fb: Framebuffer
  /** SVG-user-space → device-pixel transform (composed with element transforms). */
  rootTransform: Matrix
  tolerance: number
  fontResolver?: FontResolver
  imageResolver?: ImageResolver
  defs: SVGDefs
  currentColor: RGBA
  maxUseDepth: number
  /** Outermost SVG root — used to skip the "nested SVG" transform on it. */
  rootNode: SVGRoot
}

/**
 * Compute the inner-viewport transform for a nested `<svg>` element: maps
 * the inner viewBox onto the (x, y, width, height) viewport defined by the
 * inner <svg>'s `x`/`y`/`width`/`height` attributes (defaulting to 0/0/auto/auto),
 * honouring its `preserveAspectRatio`.
 */
function nestedSvgTransform(node: SVGRoot): Matrix {
  const ox = node.x ?? 0
  const oy = node.y ?? 0
  const vb = node.viewBox
  if (!vb) return [1, 0, 0, 1, ox, oy]
  const vpW = node.width || vb.width
  const vpH = node.height || vb.height
  const sxRaw = vpW / vb.width
  const syRaw = vpH / vb.height
  const par = node.preserveAspectRatio
  if (par.align === 'none') {
    return [sxRaw, 0, 0, syRaw, ox - vb.x * sxRaw, oy - vb.y * syRaw]
  }
  const scaleU = par.meetOrSlice === 'slice' ? Math.max(sxRaw, syRaw) : Math.min(sxRaw, syRaw)
  const slackX = vpW - vb.width * scaleU
  const slackY = vpH - vb.height * scaleU
  const xAlign = par.align.startsWith('xMin') ? 0 : par.align.startsWith('xMax') ? 1 : 0.5
  const yAlign = par.align.includes('YMin') ? 0 : par.align.includes('YMax') ? 1 : 0.5
  return [scaleU, 0, 0, scaleU, ox + slackX * xAlign - vb.x * scaleU, oy + slackY * yAlign - vb.y * scaleU]
}

interface InheritedStyle {
  fill: RGBA | null
  stroke: RGBA | null
  /** Original fill string (e.g. `"url(#g)"`) — needed so paint-server refs cascade. */
  fillRef?: string | null
  strokeRef?: string | null
  strokeWidth: number
  strokeLineCap: StrokeStyle['cap']
  strokeLineJoin: StrokeStyle['join']
  strokeMiterLimit: number
  strokeDashArray: number[]
  strokeDashOffset: number
  opacity: number
  fillOpacity: number
  strokeOpacity: number
  transform: Matrix
  clipPath?: string
  mask?: string
  /** Cascaded `color` value used to resolve `currentColor` paints. */
  currentColor: RGBA
  /** Active `<use>` recursion depth — bumped per `<use>` resolution. */
  useDepth: number
  fillRule: 'nonzero' | 'evenodd'
  paintOrder: ReadonlyArray<'fill' | 'stroke' | 'markers'>
  vectorEffect: 'none' | 'non-scaling-stroke'
}

function inheritStyle(parent: InheritedStyle, node: BaseNode): InheritedStyle {
  // Cheap-path: scan the node first for ANY override. If nothing overrides
  // the parent style, we can return parent unchanged — the InheritedStyle
  // object is read-only, so sharing the reference is safe and saves one
  // 25-field shallow-clone per node visit.
  const colorAttr = node.attrs?.color
  if (
    colorAttr == null
    && node.fill === undefined
    && node.stroke === undefined
    && node.strokeWidth == null
    && !node.strokeLineCap
    && !node.strokeLineJoin
    && node.strokeMiterLimit == null
    && !node.strokeDashArray
    && node.strokeDashOffset == null
    && node.opacity == null
    && node.fillOpacity == null
    && node.strokeOpacity == null
    && !node.transform
    && node.clipPath === undefined
    && node.mask === undefined
    && !node.fillRule
    && !node.paintOrder
    && !node.vectorEffect
  ) {
    return parent
  }

  const out: InheritedStyle = { ...parent }
  if (colorAttr) out.currentColor = parseColor(colorAttr, parent.currentColor)
  if (node.fill === null) { out.fill = null; out.fillRef = null }
  else if (node.fill !== undefined) {
    out.fill = parseColor(node.fill, out.currentColor)
    out.fillRef = node.fill
  }
  if (node.stroke === null) { out.stroke = null; out.strokeRef = null }
  else if (node.stroke !== undefined) {
    out.stroke = parseColor(node.stroke, out.currentColor)
    out.strokeRef = node.stroke
  }
  if (node.strokeWidth != null) out.strokeWidth = node.strokeWidth
  if (node.strokeLineCap) out.strokeLineCap = node.strokeLineCap
  if (node.strokeLineJoin) out.strokeLineJoin = node.strokeLineJoin
  if (node.strokeMiterLimit != null) out.strokeMiterLimit = node.strokeMiterLimit
  if (node.strokeDashArray) out.strokeDashArray = node.strokeDashArray
  if (node.strokeDashOffset != null) out.strokeDashOffset = node.strokeDashOffset
  if (node.opacity != null) out.opacity = node.opacity
  if (node.fillOpacity != null) out.fillOpacity = node.fillOpacity
  if (node.strokeOpacity != null) out.strokeOpacity = node.strokeOpacity
  if (node.transform) out.transform = multiply(parent.transform, node.transform)
  if (node.clipPath !== undefined) out.clipPath = node.clipPath
  if (node.mask !== undefined) out.mask = node.mask
  if (node.fillRule) out.fillRule = node.fillRule
  if (node.paintOrder) out.paintOrder = node.paintOrder
  if (node.vectorEffect) out.vectorEffect = node.vectorEffect
  return out
}

function effectiveFill(s: InheritedStyle): RGBA | null {
  if (!s.fill) return null
  const opacity = s.opacity * s.fillOpacity
  if (opacity >= 1) return s.fill
  return { ...s.fill, a: Math.round(s.fill.a * opacity) }
}

function effectiveStroke(s: InheritedStyle): { color: RGBA, width: number } | null {
  if (!s.stroke) return null
  const opacity = s.opacity * s.strokeOpacity
  const a = Math.round(s.stroke.a * opacity)
  if (a === 0) return null
  return { color: { ...s.stroke, a }, width: s.strokeWidth }
}

/** Apply a 2x3 transform to a flat polygon `[x0, y0, x1, y1, ...]`.
 *
 * Pre-sized `new Array(n)` is significantly faster than `Array.from({length})`
 * in V8/Bun (the latter goes through a generic iterable path). Identity
 * transform returns the input directly — no allocation. */
function transformPoly(poly: number[], m: Matrix): number[] {
  const n = poly.length
  const a = m[0], b = m[1], c = m[2], d = m[3], tx = m[4], ty = m[5]
  // Identity fast-path — no copy needed because callers don't mutate.
  if (a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0) return poly
  const out = new Array<number>(n)
  for (let i = 0; i < n; i += 2) {
    const x = poly[i]!, y = poly[i + 1]!
    out[i] = a * x + c * y + tx
    out[i + 1] = b * x + d * y + ty
  }
  return out
}

// Shape-specific contour generators (in element-local user space).
function rectToPolys(r: SVGRect, tolerance: number): number[][] {
  // Resolve rx/ry per SVG spec § rect: missing one defaults to the other,
  // and each is clamped to half the corresponding side length.
  let rx = r.rx ?? r.ry ?? 0
  let ry = r.ry ?? r.rx ?? 0
  rx = Math.max(0, Math.min(rx, r.width / 2))
  ry = Math.max(0, Math.min(ry, r.height / 2))

  if (rx === 0 || ry === 0) {
    return [[
      r.x, r.y,
      r.x + r.width, r.y,
      r.x + r.width, r.y + r.height,
      r.x, r.y + r.height,
    ]]
  }

  // Build the rounded path as four straight edges joined by four
  // quarter-ellipse arcs. Each arc is a 4-cubic-bezier approximation
  // (kappa = 4*(√2 - 1)/3 ≈ 0.5522) flattened to lines for the rasterizer.
  const KAPPA = 4 * (Math.SQRT2 - 1) / 3
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  const x0 = r.x, y0 = r.y
  const x1 = r.x + r.width, y1 = r.y + r.height
  const out: number[] = []
  // Start at top-left after the corner
  out.push(x0 + rx, y0)
  // Top edge → top-right corner
  out.push(x1 - rx, y0)
  flattenCubic(x1 - rx, y0, x1 - rx + ox, y0, x1, y0 + ry - oy, x1, y0 + ry, tolerance, out)
  // Right edge → bottom-right corner
  out.push(x1, y1 - ry)
  flattenCubic(x1, y1 - ry, x1, y1 - ry + oy, x1 - rx + ox, y1, x1 - rx, y1, tolerance, out)
  // Bottom edge → bottom-left corner
  out.push(x0 + rx, y1)
  flattenCubic(x0 + rx, y1, x0 + rx - ox, y1, x0, y1 - ry + oy, x0, y1 - ry, tolerance, out)
  // Left edge → top-left corner
  out.push(x0, y0 + ry)
  flattenCubic(x0, y0 + ry, x0, y0 + ry - oy, x0 + rx - ox, y0, x0 + rx, y0, tolerance, out)
  return [out]
}

function ellipseToPolys(cx: number, cy: number, rx: number, ry: number, tolerance: number): number[][] {
  if (rx <= 0 || ry <= 0) return []
  // For a circle of radius r, n equal-arc segments give max sagitta
  // r * (1 − cos(π/n)). Solve for n at the requested tolerance.
  const r = rx > ry ? rx : ry
  const arg = 1 - tolerance / r
  const argClamped = arg < -1 ? -1 : arg > 1 ? 1 : arg
  const denom = Math.acos(argClamped)
  const n = denom > 0
    ? (denom < Math.PI / 4096 ? 4096 : Math.ceil(Math.PI / denom) < 16 ? 16 : Math.ceil(Math.PI / denom))
    : 16
  const pts = new Array<number>(n * 2)
  // Two-mul rotation recurrence: (cos(a + da), sin(a + da)) computed as
  //   cosNew = cos*c - sin*s
  //   sinNew = sin*c + cos*s
  // where (c, s) = (cos(da), sin(da)). One sin + one cos for the entire loop.
  const da = (2 * Math.PI) / n
  const c = Math.cos(da)
  const s = Math.sin(da)
  let cosA = 1
  let sinA = 0
  for (let i = 0; i < n; i++) {
    pts[i * 2] = cx + cosA * rx
    pts[i * 2 + 1] = cy + sinA * ry
    const newCos = cosA * c - sinA * s
    sinA = sinA * c + cosA * s
    cosA = newCos
  }
  return [pts]
}


function polygonToPolys(p: SVGPolygon): number[][] {
  if (p.points.length < 2) return []
  const flat: number[] = []
  for (const [x, y] of p.points) flat.push(x, y)
  return [flat]
}

// Per-shape cache — keyed by the path node identity. Each <path> only renders
// once per renderNode call, but the fill+stroke split would otherwise parse
// and flatten the path's `d` attribute twice. The cache is keyed weakly so
// nodes don't keep their parsed flattenings alive after rendering.
const pathFlattenCache = new WeakMap<SVGPath, { tolerance: number, contours: Array<{ points: number[], closed: boolean }> }>()

function flattenPath(p: SVGPath, tolerance: number): Array<{ points: number[], closed: boolean }> {
  const cached = pathFlattenCache.get(p)
  if (cached && cached.tolerance === tolerance) return cached.contours
  const contours = flattenCommands(parsePath(p.d), tolerance)
  pathFlattenCache.set(p, { tolerance, contours })
  return contours
}

function pathToPolys(p: SVGPath, tolerance: number): number[][] {
  const contours = flattenPath(p, tolerance)
  const out = new Array<number[]>(contours.length)
  for (let i = 0; i < contours.length; i++) out[i] = contours[i]!.points
  return out
}

function pathToPolylines(p: SVGPath, tolerance: number): Array<{ points: number[], closed: boolean }> {
  return flattenPath(p, tolerance)
}

function textToPolys(node: SVGText, tolerance: number, resolver: FontResolver | undefined): number[][] {
  if (!resolver || node.text.length === 0) return []
  const font = resolver(node.fontFamily, node.fontSize)
  if (!font) return []
  // Pass the same shaping options to BOTH calls — if the font applies liga
  // in `getPath` but a different default in `getAdvanceWidth`, the textAnchor
  // offset would drift left/right of the actual glyph run.
  const fontOpts: { features: { liga: true, kern: true } } = { features: { liga: true, kern: true } }
  const advance = font.getAdvanceWidth(node.text, node.fontSize, fontOpts)
  const offset = node.textAnchor === 'middle' ? -advance / 2 : node.textAnchor === 'end' ? -advance : 0
  const path = font.getPath(node.text, node.x + offset, node.y, node.fontSize, fontOpts)
  const cmds = parsePath(path.toPathData(3))
  return flattenCommands(cmds, tolerance).map(c => c.points)
}

function shapeToPolys(node: SVGElementNode, tolerance: number, resolver: FontResolver | undefined): number[][] {
  switch (node.tag) {
    case 'rect': return rectToPolys(node, tolerance)
    case 'circle': return ellipseToPolys(node.cx, node.cy, node.r, node.r, tolerance)
    case 'ellipse': return ellipseToPolys(node.cx, node.cy, node.rx, node.ry, tolerance)
    // A bare <line> has no fill area; emitted via the stroke pass.
    case 'line': return []
    case 'polygon':
    case 'polyline': return polygonToPolys(node)
    case 'path': return pathToPolys(node, tolerance)
    case 'text': return textToPolys(node, tolerance, resolver)
    case 'use': return [] // resolved at the renderNode level
    case 'image': return [] // sampled directly by drawImage
  }
}

/** Extract a stroke polyline (as polylines, not closed polygons) from a shape. */
function shapeToPolylines(node: SVGElementNode, tolerance: number, resolver: FontResolver | undefined): { polys: number[][], closed: boolean } {
  switch (node.tag) {
    case 'line': return { polys: [[node.x1, node.y1, node.x2, node.y2]], closed: false }
    case 'polygon': return { polys: polygonToPolys(node), closed: true }
    case 'polyline': return { polys: polygonToPolys(node), closed: false }
    default: return { polys: shapeToPolys(node, tolerance, resolver), closed: true }
  }
}

/** Composite `src` over `dest` (Porter-Duff). Same dimensions assumed. */
function compositeOver(dest: Framebuffer, src: Framebuffer): void {
  const dd = dest.data
  const sd = src.data
  const len = dd.length
  for (let i = 0; i < len; i += 4) {
    const sa = sd[i + 3]!
    if (sa === 0) continue
    const da = dd[i + 3]!
    if (da === 0) {
      // Empty destination — straight copy.
      dd[i] = sd[i]!
      dd[i + 1] = sd[i + 1]!
      dd[i + 2] = sd[i + 2]!
      dd[i + 3] = sa
      continue
    }
    if (sa === 255) {
      // Opaque source — overwrites destination.
      dd[i] = sd[i]!
      dd[i + 1] = sd[i + 1]!
      dd[i + 2] = sd[i + 2]!
      dd[i + 3] = 255
      continue
    }
    const sav = sa / 255
    const dav = da / 255
    const oneMinus = 1 - sav
    const oa = sav + dav * oneMinus
    if (oa === 0) continue
    const inv = 1 / oa
    dd[i]     = ((sd[i]!     * sav + dd[i]!     * dav * oneMinus) * inv + 0.5) | 0
    dd[i + 1] = ((sd[i + 1]! * sav + dd[i + 1]! * dav * oneMinus) * inv + 0.5) | 0
    dd[i + 2] = ((sd[i + 2]! * sav + dd[i + 2]! * dav * oneMinus) * inv + 0.5) | 0
    dd[i + 3] = ((oa * 255) + 0.5) | 0
  }
}

/**
 * Zero the alpha of every pixel outside the user-space rect (x, y, w, h)
 * after transforming by `userToDev`. Used to honour `<mask x= y= width= height=>`.
 */
function clipFramebufferToRect(fb: Framebuffer, userToDev: Matrix, x: number, y: number, w: number, h: number): void {
  // Map the rect's four corners and take the axis-aligned device-space bbox.
  const a = userToDev[0], b = userToDev[1], c = userToDev[2], d = userToDev[3], tx = userToDev[4], ty = userToDev[5]
  const x2 = x + w, y2 = y + h
  // Inline the four corners — saves an array allocation + tuple destructuring.
  const dx0 = a * x  + c * y  + tx, dy0 = b * x  + d * y  + ty
  const dx1 = a * x2 + c * y  + tx, dy1 = b * x2 + d * y  + ty
  const dx2 = a * x2 + c * y2 + tx, dy2 = b * x2 + d * y2 + ty
  const dx3 = a * x  + c * y2 + tx, dy3 = b * x  + d * y2 + ty
  let xMin = dx0, xMax = dx0, yMin = dy0, yMax = dy0
  if (dx1 < xMin) xMin = dx1; if (dx1 > xMax) xMax = dx1
  if (dx2 < xMin) xMin = dx2; if (dx2 > xMax) xMax = dx2
  if (dx3 < xMin) xMin = dx3; if (dx3 > xMax) xMax = dx3
  if (dy1 < yMin) yMin = dy1; if (dy1 > yMax) yMax = dy1
  if (dy2 < yMin) yMin = dy2; if (dy2 > yMax) yMax = dy2
  if (dy3 < yMin) yMin = dy3; if (dy3 > yMax) yMax = dy3

  const fbW = fb.width
  const fbH = fb.height
  const data = fb.data
  let xL = Math.floor(xMin); if (xL < 0) xL = 0
  let yL = Math.floor(yMin); if (yL < 0) yL = 0
  let xR = Math.ceil(xMax); if (xR > fbW) xR = fbW
  let yR = Math.ceil(yMax); if (yR > fbH) yR = fbH

  for (let py = 0; py < fbH; py++) {
    const rowOff = py * fbW * 4
    if (py >= yL && py < yR) {
      // Zero alpha-channel byte (offset 3) for px in [0, xL) and [xR, fbW).
      for (let px = 0; px < xL; px++) data[rowOff + px * 4 + 3] = 0
      for (let px = xR; px < fbW; px++) data[rowOff + px * 4 + 3] = 0
    }
    else {
      // Entire row outside the region — zero every alpha byte in the row.
      for (let px = 0; px < fbW; px++) data[rowOff + px * 4 + 3] = 0
    }
  }
}

/** Multiply target alpha by mask alpha pixel-by-pixel. */
function multiplyAlpha(target: Framebuffer, mask: Framebuffer): void {
  const td = target.data
  const md = mask.data
  const len = td.length
  // Bayer-like rounded integer multiply: (a*b + 127) / 255 ≈ Math.round(a*b/255)
  // — accurate in [0, 255] without a divide.
  for (let i = 3; i < len; i += 4) {
    const t = td[i]!
    if (t === 0) continue
    const m = md[i]!
    if (m === 255) continue
    if (m === 0) { td[i] = 0; continue }
    td[i] = ((t * m + 127) * 257) >>> 16
  }
}

/** Multiply target alpha by mask luminance (per SVG spec for `<mask>`). */
function multiplyLuminance(target: Framebuffer, mask: Framebuffer): void {
  const td = target.data
  const md = mask.data
  const len = td.length
  for (let i = 0; i < len; i += 4) {
    const ta = td[i + 3]!
    if (ta === 0) continue
    const ma = md[i + 3]!
    if (ma === 0) { td[i + 3] = 0; continue }
    // ITU-R BT.601 luma × source alpha — kept in floats since coefficients
    // aren't integer-friendly, but we skip the divide via /255² combined.
    const lum = (0.299 * md[i]! + 0.587 * md[i + 1]! + 0.114 * md[i + 2]!) * ma
    // lum is in [0, 255²] now; we want round(ta * lum / 255²).
    td[i + 3] = ((ta * lum) / 65025 + 0.5) | 0
  }
}

/**
 * Resolve the effective `Paint` for a fill or stroke. Returns:
 *   - `null` if no paint should be applied
 *   - an RGBA for solid colours
 *   - a sample-able paint for url(#…) gradient references
 */
function resolvePaint(
  ref: string | null | undefined,
  baseColor: RGBA | null,
  defs: SVGDefs,
  pathBBox: { x: number, y: number, width: number, height: number },
  finalT: Matrix,
): Paint | null {
  if (ref) {
    const id = parseUrlRef(ref)
    if (id) {
      const grad = defs.gradients.get(id)
      if (grad) {
        const inv = invertMatrix(finalT)
        if (!inv) return null
        const ctx: PaintContext = { bbox: pathBBox, devToUser: inv }
        return buildGradientPaint(grad, ctx)
      }
    }
  }
  return baseColor
}

function renderNode(node: SVGNode, parentStyle: InheritedStyle, ctx: RenderCtx): void {
  const style = inheritStyle(parentStyle, node)

  // <use> resolution: render the referenced element with the use's
  // (x, y) translation prepended and the use element's style applied.
  // We cap recursion depth to defend against cyclic references like
  // <use href="#a"> inside an element with id="a".
  if (node.tag === 'use') {
    if (style.useDepth >= ctx.maxUseDepth) {
      if (config.verbose) {
        console.warn(`ts-svg: <use href="#${(node as SVGUse).href}"> exceeded maxUseDepth (${ctx.maxUseDepth}); skipping`)
      }
      return
    }
    const target = ctx.defs.byId.get((node as SVGUse).href)
    if (!target) return
    const useT: Matrix = [1, 0, 0, 1, (node as SVGUse).x, (node as SVGUse).y]
    const composedTransform = multiply(style.transform, useT)
    const newStyle: InheritedStyle = { ...style, transform: composedTransform, useDepth: style.useDepth + 1 }
    renderNode(target, newStyle, ctx)
    return
  }

  if (node.tag === 'svg' || node.tag === 'g') {
    // Nested <svg>: apply its own viewBox + preserveAspectRatio as an extra
    // transform layered on top of the parent's so its children render in the
    // inner viewport's coordinate system. (For the root svg, this is already
    // baked into ctx.rootTransform.)
    let nodeStyle = style
    if (node.tag === 'svg' && (node as SVGRoot).viewBox && node !== ctx.rootNode) {
      const t = nestedSvgTransform(node as SVGRoot)
      nodeStyle = { ...style, transform: multiply(style.transform, t) }
    }

    // Group `opacity` per spec composites the WHOLE group then applies alpha,
    // not per-child. We detect a group-level opacity ratio by comparing the
    // post-cascade `opacity` to the pre-cascade parent's, and if a node sets
    // its own opacity (anything other than 1) we route through renderLayer.
    // Same for clip-path / mask.
    const clipId = parseUrlRef(nodeStyle.clipPath ?? null)
    const maskId = parseUrlRef(nodeStyle.mask ?? null)
    const ownOpacity = node.opacity != null && node.opacity < 1
    if (clipId || maskId || ownOpacity) {
      renderLayer(node, nodeStyle, ctx, clipId, maskId, ownOpacity ? node.opacity! : 1)
      return
    }
    const children = node.children
    for (let i = 0; i < children.length; i++) renderNode(children[i]!, nodeStyle, ctx)
    return
  }

  // <image>: bypass the polygon pipeline; sample the resolved RGBA buffer
  // straight into the framebuffer with the appropriate transform.
  if (node.tag === 'image') {
    drawImage(node as SVGImage, style, ctx)
    return
  }

  // Shape element: handle clip / mask the same way (offscreen if either is set).
  const clipId = parseUrlRef(style.clipPath ?? null)
  const maskId = parseUrlRef(style.mask ?? null)
  if (clipId || maskId) {
    renderLayer(node, style, ctx, clipId, maskId)
    return
  }

  drawShape(node, style, ctx)
}

/**
 * Sample a resolved bitmap into the framebuffer, applying the element's
 * transform and `preserveAspectRatio`. Bilinear sampling for quality.
 */
function drawImage(node: SVGImage, style: InheritedStyle, ctx: RenderCtx): void {
  if (!ctx.imageResolver) return
  const img = ctx.imageResolver(node.href)
  if (!img || node.width <= 0 || node.height <= 0) return

  const finalT = multiply(ctx.rootTransform, style.transform)
  const inv = invertMatrix(finalT)
  if (!inv) return

  // Determine the sub-rect of (node.x..node.x+w, node.y..node.y+h) into which
  // the image is drawn, honouring preserveAspectRatio.
  let dx = node.x, dy = node.y, dw = node.width, dh = node.height
  const par = node.preserveAspectRatio
  if (par.align !== 'none' && img.width > 0 && img.height > 0) {
    const srcAspect = img.width / img.height
    const dstAspect = node.width / node.height
    const slice = par.meetOrSlice === 'slice'
    const adjustWidth = slice ? srcAspect > dstAspect : srcAspect < dstAspect
    if (adjustWidth) {
      const newW = node.height * srcAspect
      const slack = node.width - newW
      const xAlign = par.align.startsWith('xMin') ? 0 : par.align.startsWith('xMax') ? 1 : 0.5
      dw = newW
      dx = node.x + slack * xAlign
    }
    else {
      const newH = node.width / srcAspect
      const slack = node.height - newH
      const yAlign = par.align.includes('YMin') ? 0 : par.align.includes('YMax') ? 1 : 0.5
      dh = newH
      dy = node.y + slack * yAlign
    }
  }

  // Walk the device-pixel bbox of the destination rect and sample the source.
  // Inline corners and finalT components to avoid the per-corner array alloc.
  const fT0 = finalT[0], fT1 = finalT[1], fT2 = finalT[2], fT3 = finalT[3], fT4 = finalT[4], fT5 = finalT[5]
  const dx2 = dx + dw, dy2 = dy + dh
  const cdx0 = fT0 * dx  + fT2 * dy  + fT4, cdy0 = fT1 * dx  + fT3 * dy  + fT5
  const cdx1 = fT0 * dx2 + fT2 * dy  + fT4, cdy1 = fT1 * dx2 + fT3 * dy  + fT5
  const cdx2 = fT0 * dx2 + fT2 * dy2 + fT4, cdy2 = fT1 * dx2 + fT3 * dy2 + fT5
  const cdx3 = fT0 * dx  + fT2 * dy2 + fT4, cdy3 = fT1 * dx  + fT3 * dy2 + fT5
  let minPx = cdx0, maxPx = cdx0, minPy = cdy0, maxPy = cdy0
  if (cdx1 < minPx) minPx = cdx1; if (cdx1 > maxPx) maxPx = cdx1
  if (cdx2 < minPx) minPx = cdx2; if (cdx2 > maxPx) maxPx = cdx2
  if (cdx3 < minPx) minPx = cdx3; if (cdx3 > maxPx) maxPx = cdx3
  if (cdy1 < minPy) minPy = cdy1; if (cdy1 > maxPy) maxPy = cdy1
  if (cdy2 < minPy) minPy = cdy2; if (cdy2 > maxPy) maxPy = cdy2
  if (cdy3 < minPy) minPy = cdy3; if (cdy3 > maxPy) maxPy = cdy3

  const fbW = ctx.fb.width
  const fbH = ctx.fb.height
  const fbData = ctx.fb.data
  const x0 = Math.max(0, Math.floor(minPx))
  const x1 = Math.min(fbW - 1, Math.ceil(maxPx))
  const y0 = Math.max(0, Math.floor(minPy))
  const y1 = Math.min(fbH - 1, Math.ceil(maxPy))
  const opacity = style.opacity * style.fillOpacity

  // Hoist inverse + image dims.
  const inv0 = inv[0], inv1 = inv[1], inv2 = inv[2], inv3 = inv[3], inv4 = inv[4], inv5 = inv[5]
  const imgW = img.width, imgH = img.height, imgData = img.data
  const sx = (imgW - 1) / dw
  const sy = (imgH - 1) / dh
  const dxEnd = dx + dw, dyEnd = dy + dh

  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5
      const ux = inv0 * cx + inv2 * cy + inv4
      const uy = inv1 * cx + inv3 * cy + inv5
      if (ux < dx || ux >= dxEnd || uy < dy || uy >= dyEnd) continue
      const fx = (ux - dx) * sx
      const fy = (uy - dy) * sy
      let ix = fx | 0; if (ix < 0) ix = 0; else if (ix > imgW - 2) ix = imgW - 2
      let iy = fy | 0; if (iy < 0) iy = 0; else if (iy > imgH - 2) iy = imgH - 2
      const tx = fx - ix, ty = fy - iy
      const u = 1 - tx, v = 1 - ty
      const i00 = (iy * imgW + ix) * 4
      const i10 = i00 + 4
      const i01 = i00 + imgW * 4
      const i11 = i01 + 4
      const r = (imgData[i00]!     * u + imgData[i10]!     * tx) * v + (imgData[i01]!     * u + imgData[i11]!     * tx) * ty
      const g = (imgData[i00 + 1]! * u + imgData[i10 + 1]! * tx) * v + (imgData[i01 + 1]! * u + imgData[i11 + 1]! * tx) * ty
      const b = (imgData[i00 + 2]! * u + imgData[i10 + 2]! * tx) * v + (imgData[i01 + 2]! * u + imgData[i11 + 2]! * tx) * ty
      const a = ((imgData[i00 + 3]! * u + imgData[i10 + 3]! * tx) * v + (imgData[i01 + 3]! * u + imgData[i11 + 3]! * tx) * ty) * opacity
      if (a <= 0) continue

      const dstIdx = (py * fbW + px) * 4
      const dstA = fbData[dstIdx + 3]!
      if (dstA === 0) {
        // Empty destination → straight write.
        fbData[dstIdx] = (r + 0.5) | 0
        fbData[dstIdx + 1] = (g + 0.5) | 0
        fbData[dstIdx + 2] = (b + 0.5) | 0
        fbData[dstIdx + 3] = (a + 0.5) | 0
        continue
      }
      const srcA = a / 255
      const dstAf = dstA / 255
      const oneMinus = 1 - srcA
      const outA = srcA + dstAf * oneMinus
      if (outA <= 0) continue
      const inv2d = 1 / outA
      fbData[dstIdx]     = ((r * srcA + fbData[dstIdx]!     * dstAf * oneMinus) * inv2d + 0.5) | 0
      fbData[dstIdx + 1] = ((g * srcA + fbData[dstIdx + 1]! * dstAf * oneMinus) * inv2d + 0.5) | 0
      fbData[dstIdx + 2] = ((b * srcA + fbData[dstIdx + 2]! * dstAf * oneMinus) * inv2d + 0.5) | 0
      fbData[dstIdx + 3] = ((outA * 255) + 0.5) | 0
    }
  }
}

/** Draw a single shape element with current style + paints. */
function drawShape(node: SVGNode, style: InheritedStyle, ctx: RenderCtx): void {
  if (node.tag === 'svg' || node.tag === 'g' || node.tag === 'use') return
  // Compute the user-space polygon set ONCE — both the fill and stroke passes
  // (and the stroke's bbox lookup for paint-server resolution) need it.
  const userPolys = shapeToPolys(node as SVGElementNode, ctx.tolerance, ctx.fontResolver)
  const finalT = multiply(ctx.rootTransform, style.transform)

  const fillRef = style.fillRef
  const strokeRef = style.strokeRef
  const fillRule = style.fillRule

  // bbox is only needed when a paint server (`url(#id)`) reference resolves
  // to a gradient. Solid-colour shapes (the overwhelming majority) skip the
  // O(N) polygon scan entirely.
  let cachedBBox: { x: number, y: number, width: number, height: number } | null = null
  const getBBox = (): { x: number, y: number, width: number, height: number } => {
    if (cachedBBox != null) return cachedBBox
    cachedBBox = userPolys.length > 0 ? polysBBox(userPolys) : { x: 0, y: 0, width: 0, height: 0 }
    return cachedBBox
  }

  // Cache device-space polys lazily — both fill and stroke (and a few
  // diagnostic paths) may need them, but if the element has only fill
  // or only stroke, we'd waste a transform pass building the other.
  let cachedDevPolys: number[][] | null = null
  const getDevPolys = (): number[][] => {
    if (cachedDevPolys != null) return cachedDevPolys
    const out = new Array<number[]>(userPolys.length)
    for (let i = 0; i < userPolys.length; i++) out[i] = transformPoly(userPolys[i]!, finalT)
    cachedDevPolys = out
    return out
  }

  const doFill = (): void => {
    if (userPolys.length === 0) return
    const fillBase = effectiveFill(style)
    // resolvePaint only consults bbox when fillRef points at a gradient. So
    // we skip the bbox compute on solid-colour fills (the common case).
    const fillPaint = fillRef
      ? resolvePaint(fillRef, fillBase, ctx.defs, getBBox(), finalT)
      : fillBase
    if (fillPaint) fillPolygons(ctx.fb, getDevPolys(), fillPaint, fillRule)
  }

  const doStroke = (): void => {
    const strokeSpec = effectiveStroke(style)
    if (!strokeSpec && !strokeRef) return
    // |a + ic| for the X column gives the X scale magnitude; same for Y col.
    const m0 = finalT[0], m1 = finalT[1], m2 = finalT[2], m3 = finalT[3]
    const sx = Math.sqrt(m0 * m0 + m1 * m1)
    const sy = Math.sqrt(m2 * m2 + m3 * m3)
    const transformScale = (sx + sy) * 0.5 || 1
    const widthScale = style.vectorEffect === 'non-scaling-stroke' ? 1 : transformScale
    const dashIn = style.strokeDashArray
    const dashArray = dashIn.length === 0
      ? dashIn
      : (() => {
          const out = new Array<number>(dashIn.length)
          for (let i = 0; i < dashIn.length; i++) out[i] = dashIn[i]! * widthScale
          return out
        })()
    const strokeStyle: StrokeStyle = {
      width: (strokeSpec?.width ?? style.strokeWidth) * widthScale,
      cap: style.strokeLineCap,
      join: style.strokeLineJoin,
      miterLimit: style.strokeMiterLimit,
      dashArray,
      dashOffset: style.strokeDashOffset * widthScale,
    }
    const baseStroke = strokeSpec?.color ?? null
    const strokePaint = strokeRef
      ? resolvePaint(strokeRef, baseStroke, ctx.defs, getBBox(), finalT)
      : baseStroke
    if (!strokePaint) return
    if (node.tag === 'path') {
      const polylines = pathToPolylines(node as SVGPath, ctx.tolerance)
      for (let i = 0; i < polylines.length; i++) {
        const sp = polylines[i]!
        const dev = transformPoly(sp.points, finalT)
        strokePolylines(ctx.fb, [dev], strokePaint, strokeStyle, sp.closed)
      }
    }
    else {
      const lp = shapeToPolylines(node as SVGElementNode, ctx.tolerance, ctx.fontResolver)
      if (lp.polys.length > 0) {
        const devPolys = new Array<number[]>(lp.polys.length)
        for (let i = 0; i < lp.polys.length; i++) devPolys[i] = transformPoly(lp.polys[i]!, finalT)
        strokePolylines(ctx.fb, devPolys, strokePaint, strokeStyle, lp.closed)
      }
    }
  }

  // SVG 2 paint-order: walk the cascaded list. Common case is the default
  // ['fill', 'stroke', 'markers'] tuple — fast-path that without invoking
  // an iterator. `markers` is a no-op (no <marker> support yet).
  const order = style.paintOrder
  if (order[0] === 'fill' && order[1] === 'stroke') {
    doFill()
    doStroke()
  }
  else {
    for (let i = 0; i < order.length; i++) {
      const phase = order[i]
      if (phase === 'fill') doFill()
      else if (phase === 'stroke') doStroke()
    }
  }
}

/**
 * Compute the user-space bbox of a node (and its descendants) — used to
 * resolve `objectBoundingBox` units on clipPath / mask referrers.
 */
function nodeUserBBox(node: SVGNode, tolerance: number, resolver: FontResolver | undefined): { x: number, y: number, width: number, height: number } {
  if (node.tag === 'svg' || node.tag === 'g') {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
    const children = node.children
    for (let i = 0; i < children.length; i++) {
      const b = nodeUserBBox(children[i]!, tolerance, resolver)
      if (b.width === 0 && b.height === 0) continue
      if (b.x < xMin) xMin = b.x
      if (b.y < yMin) yMin = b.y
      if (b.x + b.width > xMax) xMax = b.x + b.width
      if (b.y + b.height > yMax) yMax = b.y + b.height
    }
    if (!Number.isFinite(xMin)) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin }
  }
  if (node.tag === 'use') return { x: 0, y: 0, width: 0, height: 0 }
  return polysBBox(shapeToPolys(node, tolerance, resolver))
}

/**
 * Render a node (or group) into a transparent offscreen buffer, then mask
 * by clip-path and/or mask refs, then composite back into the main fb.
 *
 * Honours `clipPathUnits` and `maskUnits`/`maskContentUnits`: when set to
 * `objectBoundingBox`, the clip/mask coordinate system is the unit square
 * mapped onto the target element's user-space bbox.
 */
function renderLayer(node: SVGNode, style: InheritedStyle, ctx: RenderCtx, clipId: string | null, maskId: string | null, layerOpacity = 1): void {
  const offscreen = createFramebuffer(ctx.fb.width, ctx.fb.height, { r: 0, g: 0, b: 0, a: 0 })
  const layerCtx: RenderCtx = { ...ctx, fb: offscreen }
  // Strip clip-path/mask from the inner style so the recursive draw doesn't
  // re-enter renderLayer ad infinitum. Reset opacity to 1 — the layer itself
  // will be alpha-modulated by `layerOpacity` after compositing.
  const innerStyle: InheritedStyle = { ...style, clipPath: undefined, mask: undefined, opacity: 1 }

  if (node.tag === 'svg' || node.tag === 'g') {
    const children = node.children
    for (let i = 0; i < children.length; i++) renderNode(children[i]!, innerStyle, layerCtx)
  }
  else {
    drawShape(node, innerStyle, layerCtx)
  }

  // Compute the target's user-space bbox once for objectBoundingBox lookups.
  let targetBBox: { x: number, y: number, width: number, height: number } | null = null
  const ensureBBox = (): { x: number, y: number, width: number, height: number } => {
    if (!targetBBox) targetBBox = nodeUserBBox(node, ctx.tolerance, ctx.fontResolver)
    return targetBBox
  }

  if (clipId) {
    const clip = ctx.defs.clipPaths.get(clipId)
    if (clip) {
      const mask = createFramebuffer(ctx.fb.width, ctx.fb.height, { r: 0, g: 0, b: 0, a: 0 })
      const maskCtx: RenderCtx = { ...ctx, fb: mask }
      // For objectBoundingBox, prepend a transform that maps the unit square
      // onto the target element's user-space bbox.
      let clipStyle: InheritedStyle = { ...innerStyle, fill: { r: 255, g: 255, b: 255, a: 255 }, stroke: null }
      if (clip.units === 'objectBoundingBox') {
        const bb = ensureBBox()
        const t: Matrix = [bb.width, 0, 0, bb.height, bb.x, bb.y]
        clipStyle = { ...clipStyle, transform: multiply(innerStyle.transform, t) }
      }
      for (const c of clip.children) renderNode(c, clipStyle, maskCtx)
      multiplyAlpha(offscreen, mask)
    }
  }

  if (maskId) {
    const mask = ctx.defs.masks.get(maskId)
    if (mask) {
      const maskFb = createFramebuffer(ctx.fb.width, ctx.fb.height, { r: 0, g: 0, b: 0, a: 0 })
      const maskCtx: RenderCtx = { ...ctx, fb: maskFb }
      let maskStyle: InheritedStyle = innerStyle
      if (mask.contentUnits === 'objectBoundingBox') {
        const bb = ensureBBox()
        const t: Matrix = [bb.width, 0, 0, bb.height, bb.x, bb.y]
        maskStyle = { ...innerStyle, transform: multiply(innerStyle.transform, t) }
      }
      for (const c of mask.children) renderNode(c, maskStyle, maskCtx)
      // Apply the mask region (x/y/width/height) by zeroing alpha outside it.
      // SVG default region in objectBoundingBox is (-10%,-10%,120%,120%) of the
      // target bbox; in userSpaceOnUse the entire viewport — both already
      // covered by the full-viewport mask buffer, so we only need to clip when
      // the author has supplied explicit values that would constrain it.
      if (mask.x != null || mask.y != null || mask.width != null || mask.height != null) {
        const mx = mask.x ?? 0
        const my = mask.y ?? 0
        const mw = mask.width ?? Infinity
        const mh = mask.height ?? Infinity
        // Region in mask units. For objectBoundingBox, the bbox transform is
        // already applied via finalT below; for userSpaceOnUse, transform via
        // rootTransform.
        let regionT: Matrix = ctx.rootTransform
        if (mask.units === 'objectBoundingBox') {
          const bb = ensureBBox()
          regionT = multiply(ctx.rootTransform, [bb.width, 0, 0, bb.height, bb.x, bb.y])
        }
        clipFramebufferToRect(maskFb, regionT, mx, my, mw, mh)
      }
      if (mask.maskType === 'alpha') multiplyAlpha(offscreen, maskFb)
      else multiplyLuminance(offscreen, maskFb)
    }
  }

  // Apply layer-level opacity (group `opacity` per spec) by scaling alpha.
  if (layerOpacity < 1) {
    let k = layerOpacity
    if (k < 0) k = 0
    if (k > 1) k = 1
    const od = offscreen.data
    const len = od.length
    for (let i = 3; i < len; i += 4) {
      const a = od[i]!
      if (a !== 0) od[i] = (a * k + 0.5) | 0
    }
  }

  compositeOver(ctx.fb, offscreen)
}

/**
 * Rasterise an SVG element tree into a framebuffer.
 */
export function rasterize(root: SVGRoot, opts: RenderOptions = {}): Framebuffer {
  const intrinsicW = root.width || (root.viewBox?.width ?? 100)
  const intrinsicH = root.height || (root.viewBox?.height ?? 100)
  const scale = opts.scale ?? 1
  const width = Math.max(1, Math.round(opts.width ?? intrinsicW * scale))
  const height = Math.max(1, Math.round(opts.height ?? intrinsicH * scale))

  // Resolve currentColor early — used both for `bg` parsing and to seed the cascade.
  const currentColor: RGBA = typeof opts.currentColor === 'string'
    ? parseColor(opts.currentColor)
    : opts.currentColor ?? parseColor(config.currentColor)

  const bgInput = opts.background ?? config.background
  const bg: RGBA = typeof bgInput === 'string'
    ? parseColor(bgInput, currentColor)
    : bgInput ?? { r: 0, g: 0, b: 0, a: 0 }

  const fb = createFramebuffer(width, height, bg)

  // Root transform: SVG user-space → device pixels, honouring preserveAspectRatio.
  let root2dev: Matrix = IDENTITY
  if (root.viewBox) {
    const vb = root.viewBox
    const sxRaw = width / vb.width
    const syRaw = height / vb.height
    const par = root.preserveAspectRatio
    let sx = sxRaw, sy = syRaw, tx = -vb.x * sxRaw, ty = -vb.y * syRaw
    if (par.align !== 'none') {
      // Uniform scale: meet = min (letterbox), slice = max (overflow).
      const scaleU = par.meetOrSlice === 'slice' ? Math.max(sxRaw, syRaw) : Math.min(sxRaw, syRaw)
      sx = scaleU
      sy = scaleU
      // Compute alignment offsets.
      const usedW = vb.width * scaleU
      const usedH = vb.height * scaleU
      const slackX = width - usedW
      const slackY = height - usedH
      const xAlign = par.align.startsWith('xMin') ? 0 : par.align.startsWith('xMax') ? 1 : 0.5
      const yAlign = par.align.includes('YMin') ? 0 : par.align.includes('YMax') ? 1 : 0.5
      tx = slackX * xAlign - vb.x * scaleU
      ty = slackY * yAlign - vb.y * scaleU
    }
    root2dev = [sx, 0, 0, sy, tx, ty]
  }
  else {
    const sx = width / intrinsicW
    const sy = height / intrinsicH
    root2dev = [sx, 0, 0, sy, 0, 0]
  }

  const ctx: RenderCtx = {
    fb,
    rootTransform: root2dev,
    tolerance: opts.tolerance ?? config.tolerance,
    fontResolver: opts.fontResolver,
    imageResolver: opts.imageResolver,
    defs: root.defs,
    currentColor,
    maxUseDepth: opts.maxUseDepth ?? config.maxUseDepth,
    rootNode: root,
  }

  // Initial style: SVG defaults — fill=black, stroke=none, stroke-width=1.
  const initialStyle: InheritedStyle = {
    fill: BLACK,
    stroke: null,
    strokeWidth: 1,
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    strokeMiterLimit: 4,
    strokeDashArray: [],
    strokeDashOffset: 0,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    transform: IDENTITY,
    currentColor,
    useDepth: 0,
    fillRule: 'nonzero',
    paintOrder: ['fill', 'stroke', 'markers'],
    vectorEffect: 'none',
  }

  renderNode(root, initialStyle, ctx)
  return fb
}

export type { Framebuffer } from './raster'
