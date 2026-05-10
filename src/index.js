import path from 'node:path';
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { extractCardData, extractUniverseData } from './extract.js';
import { renderPackageSvg, renderUniverseSvg } from './render.js';
import { resolveLogo } from './logo.js'

export function generatePackageSvg(pkgJson) {
  const data = extractCardData(pkgJson);
  return resolveLogo(data).then((logo) => renderPackageSvg(data, logo));
}

export function generateUniverseSvg(summaryJson) {
  const data = extractUniverseData(summaryJson);
  return resolveLogo(data).then((logo) => renderUniverseSvg(data, logo));
}

export function svgToPng(svg) {
  const assetsDir = path.join(import.meta.dirname, '..', 'assets');
  // We ship STATIC TTFs at each used weight. resvg-js doesn't honour the
  // OpenType `wght` axis on variable fonts, and `fontBuffers` interacts
  // badly with `fitTo`. Static instances + `fontFiles` is the working
  // combination.
  const fontFiles = [
    'Inter-Regular.ttf',
    'Inter-Medium.ttf',
    'Inter-SemiBold.ttf',
    'Inter-Bold.ttf',
    'Inter-Italic.ttf',
  ]
    .map((f) => path.join(assetsDir, f))
    .filter(fs.existsSync);

  return new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: {
      fontFiles,
      defaultFontFamily: 'Inter',
      // We ship the only fonts the SVG references; the system-font scan
      // costs ~30–80 ms per call with no benefit here.
      loadSystemFonts: false,
    },
    background: 'rgba(255,255,255,0)',
    logLevel: 'error',
  }).render().asPng();
}
