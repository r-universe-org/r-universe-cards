import fs from 'node:fs';
import path from 'node:path';
import { generateSvg, svgToPng, extractCardData } from '../src/index.js';

const outDir = path.join(import.meta.dirname, '..', 'output');
fs.mkdirSync(outDir, { recursive: true });

// A handful of packages that exercise the different layout cases:
//   * org with package logo (sf, ggplot2)
//   * org with no logo, falls back to avatar (magick, scater, commonmark)
//   * user-owned universe, falls back to circle-cropped user avatar
//     (curl, RProtoBuf)
//   * many-tagged package (scater) — exercises the 5-tag cap
//   * Bioconductor pseudo-universe (scater) — exercises the bioc → Bioconductor
//     login fallback (skipped now since we use the uuid path, but still here as
//     a real-world test case)
const examples = [
  { owner: 'r-spatial',            pkg: 'sf' },
  { owner: 'tidyverse',            pkg: 'ggplot2' },
  { owner: 'ropensci',             pkg: 'magick' },
  { owner: 'jeroen',               pkg: 'curl' },
  { owner: 'jeroen',               pkg: 'V8' },
  { owner: 'eddelbuettel',         pkg: 'RProtoBuf' },
  { owner: 'bioc',                 pkg: 'scater' },
  { owner: 'r-lib',                pkg: 'commonmark' },
  { owner: 'r-multiverse-staging', pkg: 'polars' },
];

// Render each card sequentially so the timing logs are in order.
examples
  .reduce((chain, ex) => chain.then(() => renderOne(ex)), Promise.resolve())
  .then(() => console.log(`\nWrote ${examples.length} cards to ${outDir}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

function renderOne({ owner, pkg }) {
  const url = `https://${owner}.r-universe.dev/api/packages/${pkg}`;
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    })
    .then((data) => {
      const card = extractCardData(data);
      const t0 = Date.now();
      return generateSvg(data).then((svg) => {
        const png = svgToPng(svg);
        const ms = Date.now() - t0;
        fs.writeFileSync(path.join(outDir, `${pkg}.svg`), svg);
        fs.writeFileSync(path.join(outDir, `${pkg}.png`), png);
        console.log(
          `${pkg.padEnd(10)} ${ms}ms  tags=${card.tags.length}  ` +
          `maintainer=${card.maintainer ? card.maintainer.name : '-'}  ` +
          `logo=${card.logo ? 'yes' : 'no '}  owner=${card.ownerLogin || '-'}${card.ownerIsOrg ? ' [org]' : ''}`
        );
      });
    });
}
