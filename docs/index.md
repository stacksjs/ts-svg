---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "ts-svg"
  text: "Pure-TypeScript SVG → PNG."
  tagline: "Parser, rasterizer, and PNG encoder for Bun & Node — no native bindings, no WASM, no Skia."
  image: /images/logo-white.png
  actions:
    - theme: brand
      text: Get Started
      link: /intro
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/ts-svg

features:
  - title: "Pure TypeScript"
    icon: "📜"
    details: "Zero native deps. Runs anywhere Bun or Node runs — including bun build --compile single-file binaries."
  - title: "Drop-in Resvg shim"
    icon: "🔁"
    details: "Swap import { Resvg } from '@resvg/resvg-js' for ts-svg with no call-site changes."
  - title: "Typed element tree"
    icon: "🌲"
    details: "parseSVG(svg) returns a typed SVGRoot you can walk, mutate, and re-rasterise."
  - title: "Analytical AA"
    icon: "✨"
    details: "4× horizontal sub-sampling, non-zero fill rule, adaptive Bezier flattening — smooth edges by default."
  - title: "Real path grammar"
    icon: "🛣️"
    details: "Full M m L l H h V v C c S s Q q T t A a Z z support, with cubic / quadratic / arc flattening."
  - title: "Gradients · clip · mask · use"
    icon: "🎨"
    details: "Linear and radial gradients (objectBoundingBox), clip-paths, masks (with alpha), and <use> with cycle-safe recursion."
---

<Home />
