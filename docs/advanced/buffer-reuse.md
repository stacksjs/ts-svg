# Buffer reuse

`Resvg#renderInto(fb)` lets you render into a pre-allocated framebuffer instead of having ts-svg allocate one per call. Use it when:

- You're rendering many frames of the same size (animation, video pipeline, scrolling thumbnail).
- You want to control the buffer's lifetime — feeding it to a native encoder, sharing it across workers, etc.
- You want to composite ts-svg output on top of pixels you produced elsewhere.

For a single one-off render, plain `render()` is simpler and just as fast.

## The buffer

```ts
import { createFramebuffer, TRANSPARENT, type Framebuffer } from 'ts-svg'

const fb: Framebuffer = createFramebuffer(800, 600, TRANSPARENT)
// { width: 800, height: 600, data: Uint8Array(800 * 600 * 4) }
```

You can also build one yourself; ts-svg only requires `width`, `height`, and a correctly-sized `Uint8Array` of RGBA bytes:

```ts
const fb: Framebuffer = {
  width: 800,
  height: 600,
  data: new Uint8Array(800 * 600 * 4),
}
```

## Rendering

```ts
import { Resvg } from 'ts-svg'

const resvg = new Resvg(svg)
resvg.renderInto(fb)
// fb.data now contains the rasterised SVG, RGBA, top-to-bottom
```

`renderInto` zeroes the buffer first by default (you can pass `{ clear: false }`, but the implementation today still overwrites with the freshly-rasterised pixels — `clear` is reserved for a future composite path). Treat `renderInto` as "rasterise into the buffer I provide" rather than "composite onto existing pixels".

For overlay / badging workflows, build the composite yourself: rasterise the SVG to its own buffer, then alpha-blend onto your destination buffer with whatever code suits your pipeline. The [Custom pipeline](/advanced/custom-pipeline) page has the building blocks.

## Encoding

`encodePng(fb)` accepts the same `Framebuffer` you handed to `renderInto`:

```ts
import { encodePng } from 'ts-svg'

resvg.renderInto(fb)
const png = encodePng(fb)
```

The encoder reads the buffer; it doesn't mutate or take ownership. You can encode the same `fb` repeatedly between renders without copying.

## Animation loop

```ts
import { Resvg, encodePng, createFramebuffer, TRANSPARENT } from 'ts-svg'

const resvg = new Resvg(svg)
const fb = createFramebuffer(640, 360, TRANSPARENT)

for (let frame = 0; frame < 120; frame++) {
  // Mutate the cached parse — see Features → Element tree
  // (e.g. update a transform, recolour a fill, …)

  resvg.renderInto(fb)
  await Bun.write(`out/${String(frame).padStart(4, '0')}.png`, encodePng(fb))
}
```

Allocating one `fb` instead of one per frame removes the steady-state GC pressure for typical icon-sized renders. For 720p+ frames the savings get larger.

## Worker pools

```ts
// main.ts
const buffers: Framebuffer[] = Array.from({ length: 4 }, () => createFramebuffer(W, H, TRANSPARENT))

// worker hands a buffer back when it's done with a render — main reuses it
```

`Framebuffer.data` is a regular `Uint8Array`. You can transfer the underlying `ArrayBuffer` between workers if you want zero-copy hand-off; just remember the `Framebuffer` wrapper on the sending side becomes unusable until the worker returns it.

## Sizing

`renderInto` does **not** resize the buffer. The render is fit into the buffer's existing `width`/`height` — equivalent to passing those dimensions as `width`/`height` on `RenderOptions`. If your SVG's aspect ratio doesn't match the buffer, you'll get the SVG's default `preserveAspectRatio` behaviour (`xMidYMid meet`) — letterboxed, centred.

To render at a different size, allocate a new buffer.

## Lifetime

```ts
const fb = createFramebuffer(W, H, TRANSPARENT)
resvg.renderInto(fb)              // safe
const png = encodePng(fb)          // safe
fb.data.fill(0)                    // safe — fb is just an object you own
resvg.renderInto(fb)              // safe — it'll re-clear and re-draw
```

There's no internal handle, no reference held by ts-svg after `renderInto` returns. Once you stop holding `fb`, GC reclaims it.
