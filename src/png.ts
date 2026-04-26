/**
 * RGBA framebuffer → PNG buffer, via `ts-png`.
 */

import { Buffer } from 'node:buffer'
import png from 'ts-png'
import type { Framebuffer } from './raster'

export function encodePng(fb: Framebuffer): Buffer {
  // ts-png expects a `data` Buffer; we already have an RGBA Uint8Array.
  const buf = Buffer.from(fb.data.buffer, fb.data.byteOffset, fb.data.byteLength)
  return png.sync.write({ width: fb.width, height: fb.height, data: buf } as { width: number, height: number, data: Buffer })
}
