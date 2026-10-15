import { extractCardData, extractUniverseData } from './extract.js';
import { renderPackageSvg, renderUniverseSvg } from './render.js';
import { resolveLogo } from './logo.js'

export { svgToPng } from './png.js';
export { svgToPngSubprocess } from './subprocess.js';

export function generatePackageSvg(pkgJson) {
  const data = extractCardData(pkgJson);
  return resolveLogo(data).then((logo) => renderPackageSvg(data, logo));
}

export function generateUniverseSvg(summaryJson) {
  const data = extractUniverseData(summaryJson);
  return resolveLogo(data).then((logo) => renderUniverseSvg(data, logo));
}
