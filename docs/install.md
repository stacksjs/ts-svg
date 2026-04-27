# Install

`ts-svg` ships as a single npm package with both a library API and a `svg` CLI. There are no native dependencies; the package itself is enough on every platform Bun or Node supports.

If you only need the library, install it like any other dependency. If you want the CLI globally without npm, prebuilt binaries are published with each release.

## Package managers

::: code-group

```sh [bun]
bun add ts-svg
# global CLI
bun add --global ts-svg
```

```sh [npm]
npm install ts-svg
# global CLI
npm install -g ts-svg
```

```sh [pnpm]
pnpm add ts-svg
# global CLI
pnpm add --global ts-svg
```

```sh [yarn]
yarn add ts-svg
# global CLI
yarn global add ts-svg
```

:::

::: tip
Bun is the best-supported runtime — the test suite, CLI binaries, and `bun build --compile` workflow are all exercised on it. Node 18+ also works through the same package; the published JS targets ES2022 plus `node:buffer`.
:::

## Programmatic use

```ts
import { svgToPng, parseSVG, rasterize, encodePng, Resvg } from 'ts-svg'
```

That single entry point covers every API documented in [Usage](/usage) and the [API reference](/api). Types are re-exported from the same module — no `/types` sub-path required.

## Prebuilt CLI binaries

Each GitHub release includes a self-contained `svg` binary built with `bun build --compile`. No runtime install needed; download the right artifact, mark it executable, drop it on your `PATH`.

Replace `<version>` with the [latest release tag](https://github.com/stacksjs/ts-svg/releases) (e.g. `v0.1.0`).

::: code-group

```sh [macOS (arm64)]
curl -L https://github.com/stacksjs/ts-svg/releases/download/<version>/svg-darwin-arm64 -o svg
chmod +x svg
mv svg /usr/local/bin/svg
```

```sh [macOS (x64)]
curl -L https://github.com/stacksjs/ts-svg/releases/download/<version>/svg-darwin-x64 -o svg
chmod +x svg
mv svg /usr/local/bin/svg
```

```sh [Linux (arm64)]
curl -L https://github.com/stacksjs/ts-svg/releases/download/<version>/svg-linux-arm64 -o svg
chmod +x svg
mv svg /usr/local/bin/svg
```

```sh [Linux (x64)]
curl -L https://github.com/stacksjs/ts-svg/releases/download/<version>/svg-linux-x64 -o svg
chmod +x svg
mv svg /usr/local/bin/svg
```

```sh [Windows (x64)]
curl -L https://github.com/stacksjs/ts-svg/releases/download/<version>/svg-windows-x64.exe -o svg.exe
move svg.exe C:\Windows\System32\svg.exe
```

:::

::: tip
You can also browse all released binaries directly on the [GitHub releases page](https://github.com/stacksjs/ts-svg/releases).
:::

## Verifying the install

```sh
svg version          # CLI binary
bun -e "import('ts-svg').then(m => console.log(Object.keys(m)))"
```

The library export list should include `parseSVG`, `rasterize`, `encodePng`, `svgToPng`, `Resvg`, and the helper utilities listed in the [API reference](/api).

## Next

- [Usage](/usage) — library and CLI walkthroughs.
- [Configuration](/config) — `svg.config.ts` defaults.
