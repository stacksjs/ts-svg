# CLI

`ts-svg` ships an `svg` executable. The same npm package installs it; releases also publish standalone binaries built with `bun build --compile`. Either entry point exposes the same commands.

## Commands

```bash
svg render [input]   # rasterise SVG → PNG
svg to-png [input]   # convenience: parseSVG + rasterize + encodePng
svg version          # print build version
svg --help           # full reference
```

## `svg render`

The full-featured command:

```bash
svg render logo.svg                             # → logo.png at intrinsic size
svg render logo.svg -o brand.png --scale 2      # 2× the intrinsic dims
svg render logo.svg --width 1024                # pin width, aspect-preserve
svg render logo.svg --background "#0ea5e9"      # solid background
svg render logo.svg --tolerance 0.1             # very smooth curves
```

| Flag | Default | Notes |
| --- | --- | --- |
| `-o, --out <file>` | `<input>.png` | Required when reading from stdin. |
| `-s, --scale <factor>` | `1` | Multiplier on the SVG's intrinsic size. |
| `-w, --width <px>` | — | Overrides scale; aspect-preserved if height omitted. |
| `-h, --height <px>` | — | Overrides scale; aspect-preserved if width omitted. |
| `-b, --background <color>` | transparent | Any CSS colour string. |
| `-t, --tolerance <px>` | `0.25` | Bezier flattening tolerance. |
| `--stdin` | — | Read SVG from stdin (overrides positional input). |

If you pass `--width` and `--height` together, both are honoured (the SVG is fitted into the box per its `preserveAspectRatio`).

## `svg to-png`

Same render, fewer knobs. Good for shell pipelines where you just want bytes:

```bash
svg to-png logo.svg -o logo.png
cat logo.svg | svg to-png --stdin -o logo.png
```

| Flag | Default | Notes |
| --- | --- | --- |
| `-o, --out <file>` | `<input>.png` | Required when reading from stdin. |
| `-s, --scale <factor>` | `1` | Multiplier on the SVG's intrinsic size. |
| `--stdin` | — | Read SVG from stdin. |

## Pipes

```bash
# pipe SVG in
curl -s https://example.com/logo.svg | svg render --stdin -o logo.png

# render with explicit dimensions
generate-svg | svg render --stdin --width 1024 --background white -o hero.png
```

`-` as the positional input is also accepted as "read from stdin", in case the tool you're piping from doesn't know about `--stdin`.

## Batching

The CLI is single-shot per invocation. For many files, drive it from your shell:

```bash
# fish/bash/zsh: render every SVG in src/icons/ at 2×
for svg in src/icons/*.svg
  svg render "$svg" --scale 2 -o "out/(basename "$svg" .svg).png"
end
```

For higher throughput, skip the fork-per-file overhead and use the library directly inside a Bun script:

```ts
// scripts/render-icons.ts
import { Resvg } from 'ts-svg'
import { Glob } from 'bun'

const icons = await Array.fromAsync(new Glob('src/icons/*.svg').scan({ cwd: '.' }))
await Promise.all(icons.map(async (path) => {
  const svg = await Bun.file(path).text()
  const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 } }).render().asPng()
  await Bun.write(path.replace(/\.svg$/, '.png'), png)
}))
```

That's typically 5–10× faster than a shell loop on a hundred icons.

## Configuration

The CLI honours `svg.config.ts` defaults the same way the library does — see [Configuration](/config). Per-invocation flags override config-file values.

## Binary distribution

Releases publish standalone binaries (no Bun / Node install needed) for:

- macOS: `svg-darwin-arm64`, `svg-darwin-x64`
- Linux: `svg-linux-arm64`, `svg-linux-x64`
- Windows: `svg-windows-x64.exe`

See [Install](/install#prebuilt-cli-binaries) for download recipes.

## Error semantics

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Render failed (parse error, invalid path data, resolver threw). |
| `2` | Bad invocation (missing input, can't read file, missing `--out` with stdin). |

Errors print to stderr; success prints `wrote <path> (<bytes> from <source>)` to stdout.
