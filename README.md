# r-universe-cards

Generate social-media preview cards (1200×630) for R-universe package pages,
in both SVG and PNG. Drop in the JSON blob from
`https://{owner}.r-universe.dev/api/packages/{package}` and you get a card
ready to drop into an `<meta property="og:image">` tag.

![ggplot2 example](output/ggplot2.png)

## Install

```sh
npm install r-universe-cards
```

This pulls in `@resvg/resvg-js` for PNG rasterisation. The package itself
ships the Inter font files needed for consistent rendering, so no system
fonts are required.

## Quick example

This is an ES module — use `import` syntax. Call `generateSvg` if you
want SVG, `generatePng` if you want PNG. Both return a Promise.

```js
import { writeFile } from 'node:fs/promises';
import { generateSvg, generatePng } from 'r-universe-cards';

const owner = 'r-spatial';
const pkg = 'sf';
const url = `https://${owner}.r-universe.dev/api/packages/${pkg}`;

fetch(url)
  .then((res) => res.json())
  .then((data) => generatePng(data)
  .then((png) => writeFile('sf.png', png)));
```

## API

### `generateSvg(pkgJson, options?)` → `Promise<string>`

Build the SVG card.

- `pkgJson` — the raw object returned by `/api/packages/{name}`.
- `options.fetchLogo` — `false` to skip downloading the package logo (and
  avatar fallback). Default `true`.
- `options.localLogoPath` — read a logo from disk instead of the network,
  useful for offline rendering.

Returns the SVG document as a UTF-8 string.

### `generatePng(pkgJson, options?)` → `Promise<Buffer>`

Same options as `generateSvg`, plus:

- `options.scale` — pixel ratio for the PNG output. `1` (default) yields
  1200×630; `2` yields 2400×1260 for retina displays.

Returns a PNG `Buffer`. Internally produces the SVG first and then
rasterises with `@resvg/resvg-js`.

### `svgToPng(svg, options?)` → `Promise<Buffer>`

Rasterise an existing SVG. Useful when you've already produced the SVG
via `generateSvg()` and want both formats without running the layout
twice.

### `extractCardData(pkgJson)` → `object`

Pure transformation from raw r-universe JSON to the structured card data
(package, title, owner, tags, maintainer, stats, etc.). Synchronous and
side-effect free. Useful for logging or building your own renderer.

### `renderSvg(card, logo?)` → `string`

Lower-level entry point. Takes a card object (output of
`extractCardData`) and an optional logo descriptor, and returns the SVG
synchronously. The package's high-level `generateSvg` calls this after
fetching the logo; use it directly if you want full control over the
logo source.

## What ends up on the card

For each package, the renderer pulls these fields out of the API response:

| Card element | Source |
|---|---|
| Brand mark (top-left) | bundled `r-universe.dev/static/logo-big.svg` |
| Tags (top-right) | `_topics`, capped at 5 |
| Logo image | `_pkglogo`, fallback to `github.com/{owner}.png` |
| Package name | `Package` |
| Title | `Title` (italic) |
| Maintained by | `_maintainer.name` (fallback `Maintainer`) |
| URL (footer-left) | constructed from `_owner` and `Package` |
| Stats (footer-right) | `_stars`, `_downloads.count`, `_vignettes.length`, `_contributors.length`, `Version` |

## Examples

The [`examples/render-examples.js`](examples/render-examples.js) script
renders cards for a handful of packages with different shapes. After
`npm install`, run:

```sh
node examples/render-examples.js
```

Outputs land in `output/`:

| Package | Notes |
|---|---|
| [sf](output/sf.png) | hex logo, single maintainer, full tag row |
| [ggplot2](output/ggplot2.png) | hex logo, two-line title |
| [magick](output/magick.png) | no logo → org avatar (rOpenSci) |
| [curl](output/curl.png) | personal universe → circle-cropped user avatar |
| [RProtoBuf](output/RProtoBuf.png) | personal universe, mixed-case name |
| [scater](output/scater.png) | bioc → Bioconductor avatar, 16 topics capped to 5 |
| [commonmark](output/commonmark.png) | r-lib org avatar, longer title |

## License

MIT for the package code. The bundled Inter font is licensed under the
SIL Open Font License 1.1.
