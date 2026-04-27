# Showcase

Projects, services, and pipelines using `ts-svg`.

## Community projects

- _Yours could be here!_

If you've shipped something built on ts-svg, share it with us in [Discussions](https://github.com/stacksjs/ts-svg/discussions), on social media, or via PR — we'll add it to this list.

## First-party

ts-svg is part of the [Stacks](https://stacksjs.org) ecosystem. Sister projects you might find interesting:

- [`@stacksjs/ts-png`](https://github.com/stacksjs/ts-png) — pure-TS PNG encoder used internally by ts-svg.
- [`bunfig`](https://github.com/stacksjs/bunfig) — config loader powering `svg.config.ts` discovery.
- [`@stacksjs/clapp`](https://github.com/stacksjs/clapp) — CLI framework used for the `svg` binary.
- [`bunpress`](https://github.com/stacksjs/bunpress) — Bun-native static site generator powering this documentation.
- [`bumpx`](https://github.com/stacksjs/bumpx) — version bumper used in the `release:*` scripts.
- [`logsmith`](https://github.com/stacksjs/logsmith) — changelog generator chained from `release:patch` / `release:minor`.

## Use cases

The shapes ts-svg is best at — pure-TS deployment, predictable rendering, no native deps:

- **Open Graph card generation** in serverless / edge runtimes where native bindings aren't available.
- **Single-file CLI tools** built with `bun build --compile` that ship as one binary across macOS / Linux / Windows.
- **Server-side icon rendering** for design systems that want PNG fallbacks for legacy clients.
- **Test pipelines** asserting visual correctness of generated SVG (paired with the pixel-fixture tests in this repo).
- **CI artifact generation** for projects that produce SVG diagrams and want PNG copies in their release notes.

If your use case isn't on this list and ts-svg fits, let us know — we'd like to learn what people are building with it.
