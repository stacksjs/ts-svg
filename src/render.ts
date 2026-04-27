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
  const out: InheritedStyle = { ...parent }
  // Thread `color` (cascaded) so `currentColor` references resolve correctly.
  const colorAttr = node.attrs?.color
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
 * Returns a plain `number[]` because downstream consumers (rasterizer,
 * stroke pipeline) iterate via `[i]` indexing — both `Array` and
 * `Float64Array` support that, but the rasterizer's `Map<number, …>` keys
 * and edge-table arithmetic are slightly faster on regular arrays in V8.
 * Keeping `number[]` avoids hot-path conversions while still benefiting
 * from a single pre-sized allocation. */
function transformPoly(poly: number[], m: Matrix): number[] {
  const n = poly.length
  const out: number[] = Array.from({ length: n })
  const a = m[0], b = m[1], c = m[2], d = m[3], tx = m[4], ty = m[5]
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
  // Clamp the acos arg to (-1, 1) — if `tolerance` exceeds the radius the
  // ratio goes negative or above 1 and acos returns NaN.
  const r = Math.max(rx, ry)
  const arg = Math.max(-1, Math.min(1, 1 - tolerance / r))
  const denom = Math.acos(arg)
  // For very flat tolerance vs radius, denom approaches 0 and n explodes —
  // cap at 4096 segments which is well past visual perfection.
  const n = denom > 0
    ? Math.max(16, Math.min(4096, Math.ceil(Math.PI / denom)))
    : 16
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  }
  return [pts]
}


function polygonToPolys(p: SVGPolygon): number[][] {
  if (p.points.length < 2) return []
  const flat: number[] = []
  for (const [x, y] of p.points) flat.push(x, y)
  return [flat]
}

function pathToPolys(p: SVGPath, tolerance: number): number[][] {
  const cmds = parsePath(p.d)
  return flattenCommands(cmds, tolerance).map(c => c.points)
}

function pathToPolylines(p: SVGPath, tolerance: number): Array<{ points: number[], closed: boolean }> {
  const cmds = parsePath(p.d)
  return flattenCommands(cmds, tolerance)
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
  for (let i = 0; i < dest.data.length; i += 4) {
    const sa = src.data[i + 3]! / 255
    if (sa === 0) continue
    const da = dest.data[i + 3]! / 255
    const oa = sa + da * (1 - sa)
    if (oa === 0) continue
    dest.data[i] = Math.round((src.data[i]! * sa + dest.data[i]! * da * (1 - sa)) / oa)
    dest.data[i + 1] = Math.round((src.data[i + 1]! * sa + dest.data[i + 1]! * da * (1 - sa)) / oa)
    dest.data[i + 2] = Math.round((src.data[i + 2]! * sa + dest.data[i + 2]! * da * (1 - sa)) / oa)
    dest.data[i + 3] = Math.round(oa * 255)
  }
}

/**
 * Zero the alpha of every pixel outside the user-space rect (x, y, w, h)
 * after transforming by `userToDev`. Used to honour `<mask x= y= width= height=>`.
 */
function clipFramebufferToRect(fb: Framebuffer, userToDev: Matrix, x: number, y: number, w: number, h: number): void {
  // Map the rect's four corners and take the axis-aligned device-space bbox.
  const corners: Array<[number, number]> = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const [cx, cy] of corners) {
    const dx = userToDev[0] * cx + userToDev[2] * cy + userToDev[4]
    const dy = userToDev[1] * cx + userToDev[3] * cy + userToDev[5]
    if (dx < xMin) xMin = dx
    if (dy < yMin) yMin = dy
    if (dx > xMax) xMax = dx
    if (dy > yMax) yMax = dy
  }
  const xL = Math.max(0, Math.floor(xMin))
  const yL = Math.max(0, Math.floor(yMin))
  const xR = Math.min(fb.width, Math.ceil(xMax))
  const yR = Math.min(fb.height, Math.ceil(yMax))
  for (let py = 0; py < fb.height; py++) {
    if (py >= yL && py < yR) {
      // Zero alpha outside [xL, xR) on this row.
      for (let px = 0; px < xL; px++) fb.data[(py * fb.width + px) * 4 + 3] = 0
      for (let px = xR; px < fb.width; px++) fb.data[(py * fb.width + px) * 4 + 3] = 0
    }
    else {
      // Entire row is outside the region.
      for (let px = 0; px < fb.width; px++) fb.data[(py * fb.width + px) * 4 + 3] = 0
    }
  }
}

/** Multiply target alpha by mask alpha pixel-by-pixel. */
function multiplyAlpha(target: Framebuffer, mask: Framebuffer): void {
  for (let i = 3; i < target.data.length; i += 4) {
    target.data[i] = Math.round((target.data[i]! * mask.data[i]!) / 255)
  }
}

/** Multiply target alpha by mask luminance (per SVG spec for `<mask>`). */
function multiplyLuminance(target: Framebuffer, mask: Framebuffer): void {
  for (let i = 0; i < target.data.length; i += 4) {
    // ITU-R BT.601 luma weights × source alpha (premultiplied)
    const lum = (0.299 * mask.data[i]! + 0.587 * mask.data[i + 1]! + 0.114 * mask.data[i + 2]!) * (mask.data[i + 3]! / 255)
    target.data[i + 3] = Math.round(target.data[i + 3]! * (lum / 255))
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
    for (const c of node.children) renderNode(c, nodeStyle, ctx)
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
  const corners: Array<[number, number]> = [
    [dx, dy], [dx + dw, dy], [dx + dw, dy + dh], [dx, dy + dh],
  ]
  let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity
  for (const [x, y] of corners) {
    const px = finalT[0] * x + finalT[2] * y + finalT[4]
    const py = finalT[1] * x + finalT[3] * y + finalT[5]
    if (px < minPx) minPx = px; if (px > maxPx) maxPx = px
    if (py < minPy) minPy = py; if (py > maxPy) maxPy = py
  }
  const x0 = Math.max(0, Math.floor(minPx))
  const x1 = Math.min(ctx.fb.width - 1, Math.ceil(maxPx))
  const y0 = Math.max(0, Math.floor(minPy))
  const y1 = Math.min(ctx.fb.height - 1, Math.ceil(maxPy))
  const opacity = style.opacity * style.fillOpacity

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5, cy = py + 0.5
      const ux = inv[0] * cx + inv[2] * cy + inv[4]
      const uy = inv[1] * cx + inv[3] * cy + inv[5]
      if (ux < dx || ux >= dx + dw || uy < dy || uy >= dy + dh) continue
      // Map dest-rect coord into source pixel coord (bilinear).
      const fx = ((ux - dx) / dw) * (img.width - 1)
      const fy = ((uy - dy) / dh) * (img.height - 1)
      const ix = Math.max(0, Math.min(img.width - 2, Math.floor(fx)))
      const iy = Math.max(0, Math.min(img.height - 2, Math.floor(fy)))
      const tx = fx - ix, ty = fy - iy
      const blend = (channel: 0 | 1 | 2 | 3): number => {
        const i00 = (iy * img.width + ix) * 4 + channel
        const i10 = (iy * img.width + ix + 1) * 4 + channel
        const i01 = ((iy + 1) * img.width + ix) * 4 + channel
        const i11 = ((iy + 1) * img.width + ix + 1) * 4 + channel
        const a = img.data[i00]! * (1 - tx) + img.data[i10]! * tx
        const b = img.data[i01]! * (1 - tx) + img.data[i11]! * tx
        return a * (1 - ty) + b * ty
      }
      const r = blend(0), g = blend(1), b = blend(2), a = blend(3) * opacity
      // Composite over destination
      const dstIdx = (py * ctx.fb.width + px) * 4
      const srcA = a / 255
      const dstA = ctx.fb.data[dstIdx + 3]! / 255
      const outA = srcA + dstA * (1 - srcA)
      if (outA <= 0) continue
      ctx.fb.data[dstIdx]     = Math.round((r * srcA + ctx.fb.data[dstIdx]!     * dstA * (1 - srcA)) / outA)
      ctx.fb.data[dstIdx + 1] = Math.round((g * srcA + ctx.fb.data[dstIdx + 1]! * dstA * (1 - srcA)) / outA)
      ctx.fb.data[dstIdx + 2] = Math.round((b * srcA + ctx.fb.data[dstIdx + 2]! * dstA * (1 - srcA)) / outA)
      ctx.fb.data[dstIdx + 3] = Math.round(outA * 255)
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
  const bbox = userPolys.length > 0 ? polysBBox(userPolys) : { x: 0, y: 0, width: 0, height: 0 }

  const fillRef = style.fillRef
  const strokeRef = style.strokeRef
  const fillRule = style.fillRule

  // Pre-build fill + stroke closures so paint-order can run them in either
  // order without code duplication.
  const doFill = (): void => {
    if (userPolys.length === 0) return
    const devPolys = userPolys.map(p => transformPoly(p, finalT))
    const fillBase = effectiveFill(style)
    const fillPaint = resolvePaint(fillRef, fillBase, ctx.defs, bbox, finalT)
    if (fillPaint) fillPolygons(ctx.fb, devPolys, fillPaint, fillRule)
  }

  const doStroke = (): void => {
    const strokeSpec = effectiveStroke(style)
    if (!strokeSpec && !strokeRef) return
    const sx = Math.hypot(finalT[0], finalT[1])
    const sy = Math.hypot(finalT[2], finalT[3])
    const transformScale = (sx + sy) / 2 || 1
    // vector-effect="non-scaling-stroke": the stroke ignores the user-space
    // → device transform's scale, so a 1px stroke remains 1px regardless
    // of zoom.
    const widthScale = style.vectorEffect === 'non-scaling-stroke' ? 1 : transformScale
    const strokeStyle: StrokeStyle = {
      width: (strokeSpec?.width ?? style.strokeWidth) * widthScale,
      cap: style.strokeLineCap,
      join: style.strokeLineJoin,
      miterLimit: style.strokeMiterLimit,
      dashArray: style.strokeDashArray.map(d => d * widthScale),
      dashOffset: style.strokeDashOffset * widthScale,
    }
    const baseStroke = strokeSpec?.color ?? null
    const strokePaint = resolvePaint(strokeRef, baseStroke, ctx.defs, bbox, finalT)
    if (!strokePaint) return
    if (node.tag === 'path') {
      for (const sp of pathToPolylines(node as SVGPath, ctx.tolerance)) {
        const dev = transformPoly(sp.points, finalT)
        strokePolylines(ctx.fb, [dev], strokePaint, strokeStyle, sp.closed)
      }
    }
    else {
      const lp = shapeToPolylines(node as SVGElementNode, ctx.tolerance, ctx.fontResolver)
      if (lp.polys.length > 0) {
        const devPolys = lp.polys.map(p => transformPoly(p, finalT))
        strokePolylines(ctx.fb, devPolys, strokePaint, strokeStyle, lp.closed)
      }
    }
  }

  // SVG 2 paint-order: walk the cascaded list. `markers` is a no-op for now.
  for (const phase of style.paintOrder) {
    if (phase === 'fill') doFill()
    else if (phase === 'stroke') doStroke()
    // 'markers' — not implemented (no <marker> element support yet).
  }
}

/**
 * Compute the user-space bbox of a node (and its descendants) — used to
 * resolve `objectBoundingBox` units on clipPath / mask referrers.
 */
function nodeUserBBox(node: SVGNode, tolerance: number, resolver: FontResolver | undefined): { x: number, y: number, width: number, height: number } {
  if (node.tag === 'svg' || node.tag === 'g') {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
    for (const c of node.children) {
      const b = nodeUserBBox(c, tolerance, resolver)
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
    for (const c of node.children) renderNode(c, innerStyle, layerCtx)
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
    const k = Math.max(0, Math.min(1, layerOpacity))
    for (let i = 3; i < offscreen.data.length; i += 4) {
      offscreen.data[i] = Math.round(offscreen.data[i]! * k)
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
