# Configuration

`ts-svg` reads project-wide defaults from a `svg.config.ts` (or `.js` / `.json`) file in your project root. The file is auto-discovered at import time via [bunfig](https://github.com/stacksjs/bunfig); anything you set there becomes the new default for every `rasterize`, `svgToPng`, and `Resvg` call that doesn't override the field explicitly.

You don't need a config file. The library ships sane defaults and works without one.

## Example

```ts
// svg.config.ts
import type { SvgConfig } from 'ts-svg'

const config: Partial<SvgConfig> = {
  tolerance: 0.5,        // coarser flattening for huge documents
  background: '#ffffff', // applied when no background is passed at the call site
  currentColor: '#1f2937',
  maxUseDepth: 8,
  verbose: true,
}

export default config
```

## Fields

| Field | Type | Default | Effect |
| --- | --- | --- | --- |
| `verbose` | `boolean` | `false` | Emit warnings to `console.warn` (e.g. unknown elements, dropped attributes). Useful in CI when you want to know what the parser is ignoring. |
| `tolerance` | `number` | `0.25` | Default Bezier flattening tolerance in user units (px). Lower = smoother curves and more polygon vertices. Raise for huge documents where you want speed over fidelity. |
| `background` | `string` | `'transparent'` | Default background colour applied when no `background` option is passed. Accepts any CSS colour string. |
| `currentColor` | `string` | `'black'` | Resolves `fill="currentColor"` and `stroke="currentColor"` references. Equivalent to CSS `color`. |
| `maxUseDepth` | `number` | `16` | Hard cap on `<use>` recursion. Prevents cycles like `#a` → `#b` → `#a` from blowing the stack; depth `0` means a `<use>` cannot reference another `<use>`. |

Unset fields fall back to the defaults above. Per-call options always win over config-file values.

## Precedence

For any field that exists at all three levels:

```
defaultConfig  <  svg.config.ts  <  call-site option
```

So a `svg.config.ts` with `background: '#fff'` makes white the project default, but `svgToPng(svg, { background: 'transparent' })` still wins for that one call.

## Discovery

bunfig walks up from the current working directory looking for `svg.config.{ts,js,json}`. The first match is used. There is no recursive merge across multiple files — if you have monorepo packages with different defaults, put a `svg.config.ts` in each package root.

## Async loading

The synchronous `config` export is the merged-defaults object available immediately at import — safe for `bun build --compile` and bundlers without top-level await. If you specifically need the user-supplied overrides loaded (rather than the bundled defaults), call `getConfig()`:

```ts
import { getConfig } from 'ts-svg'

const cfg = await getConfig() // merges svg.config.ts on top of defaults
```

`getConfig()` caches the promise; calling it repeatedly does not re-read the file. The returned object is the same singleton that `import { config } from 'ts-svg'` exposes — the loader mutates it in place so existing references stay live.

## Render-time options

Some options live on `RenderOptions` rather than `SvgConfig` because they don't make sense as project-wide defaults — `width`, `height`, `scale`, `fontResolver`, `imageResolver`. See the [API reference](/api#renderoptions) for the full list.
