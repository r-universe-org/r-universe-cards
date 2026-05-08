import path from 'node:path';
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { extractCardData } from './extract.js';
import { renderSvg } from './render.js';
import { fetchLogo } from './logo.js';

/**
 * Generate the SVG for an r-universe package card.
 *
 * The SVG references Inter via a single Google Fonts `@import` line, so
 * any modern browser displays the card correctly without needing Inter
 * installed locally. resvg-js (the PNG path) ignores the `@import` and
 * uses the bundled TTFs in `assets/` instead.
 *
 * @param {object} pkgJson  Raw JSON from /api/packages/{package}.
 * @param {object} [options]
 * @param {boolean} [options.fetchLogo=true]  Whether to download the package
 *        logo (when present). Set false for offline use; the layout reflows.
 * @returns {Promise<string>}  The SVG document as a UTF-8 string.
 */
export function generateSvg(pkgJson, options = {}) {
  const card = extractCardData(pkgJson);
  return resolveLogo(card, options).then((logo) => renderSvg(card, logo));
}

/**
 * Generate the PNG for an r-universe package card.
 *
 * Internally produces the SVG first, then rasterises with @resvg/resvg-js.
 * If you need both formats, call generateSvg() once and pass the result to
 * svgToPng() — that avoids re-fetching the logo and re-running the layout.
 *
 * @param {object} pkgJson  Raw JSON from /api/packages/{package}.
 * @param {object} [options]  Same as generateSvg, plus:
 *   {number} options.scale   pixel ratio (default 1; 2 for retina, etc.).
 * @returns {Promise<Buffer>}  PNG bytes.
 */
export function generatePng(pkgJson, options = {}) {
  return generateSvg(pkgJson, options).then((svg) => svgToPng(svg, options));
}

/**
 * Rasterise an SVG card to PNG using @resvg/resvg-js. Synchronous — once
 * an SVG is in hand, rasterising is CPU-bound work with no I/O.
 *
 * @param {string} svg
 * @param {object} [options]
 * @param {number} [options.scale=1]  pixel ratio.
 * @returns {Buffer}
 */
export function svgToPng(svg, options = {}) {
  const assetsDir = path.join(import.meta.dirname, '..', 'assets');
  // Two notes on font loading:
  //
  //   1. We pass `fontFiles` (paths) rather than `fontBuffers`. resvg-js
  //      2.6.2 has a quirk where setting `fontBuffers` silently disables
  //      `fitTo`, so callers passing `scale: 2` would get back a 1× image.
  //
  //   2. We ship STATIC TTFs at each used weight, not a single variable
  //      TTF, because resvg-js does not honour the OpenType `wght` axis
  //      on variable fonts — every weight from 400 to 900 would rasterise
  //      identically, so `font-weight="700"` text would render as regular.
  //      Static instances let resvg pick the right file per weight.
  const fontFiles = [
    'Inter-Regular.ttf',
    'Inter-Medium.ttf',
    'Inter-SemiBold.ttf',
    'Inter-Bold.ttf',
    'Inter-Italic.ttf',
  ]
    .map((f) => path.join(assetsDir, f))
    .filter(fs.existsSync);

  const resvg = new Resvg(svg, {
    fitTo: options.scale && options.scale !== 1
      ? { mode: 'zoom', value: options.scale }
      : { mode: 'original' },
    font: {
      fontFiles,
      defaultFontFamily: 'Inter',
      // We ship the only fonts the SVG references, so disable the system
      // font scan — it costs ~30–80 ms per call with no benefit.
      loadSystemFonts: false,
    },
    background: 'rgba(255,255,255,0)',
    logLevel: 'error',
  });
  return resvg.render().asPng();
}

export { extractCardData, renderSvg };

/* ------------------------------ internals ------------------------------ */

function resolveLogo(card, options) {
  // Offline / opt-out path so the renderer can be exercised without network.
  if (options.fetchLogo === false) return Promise.resolve(null);

  // Fix infinite recursion when logo is the card itself
  if(card.logo && card.logo.match(".*r-universe.dev/.*/card\.*")) {
    card.logo = null;
  }

  const packageLogo = card.logo ? fetchLogo(card.logo) : Promise.resolve(null);
  return packageLogo.then((logo) => {
    if (logo) return logo;
    const avatarUrl = ownerAvatarUrl(card);
    if (!avatarUrl) return null;
    // Fallback: GitHub owner/organization avatar. Tag the logo with the
    // owner kind so the renderer can apply per-kind treatment — user
    // avatars are circle-cropped, org avatars stay square.
    return fetchLogo(avatarUrl).then((avatar) => {
      if (avatar) {
        avatar.isUserAvatar = !card.ownerIsOrg;
      }
      return avatar;
    });
  });
}

/**
 * Build the URL for the owner's GitHub avatar. When the r-universe API
 * gave us the owner's GitHub UUID (via `_userbio.uuid`) we go straight
 * to avatars.githubusercontent.com — that skips the github.com → avatars
 * redirect (one round-trip per fetch) and also bypasses the special
 * pseudo-universe mapping (e.g. `bioc` → `Bioconductor`) entirely, since
 * the UUID already points at the right GitHub org. Falls back to the
 * login-based URL if no UUID is available.
 */
function ownerAvatarUrl(card) {
  if (card.ownerLogin == 'cran') {
    return 'https://cran.r-project.org/CRANlogo.svg';
  }
  if (card.ownerUuid) {
    return `https://avatars.githubusercontent.com/u/${card.ownerUuid}?size=460`;
  }
  if (!card.ownerLogin) return null;
  // Some r-universe pseudo-universes have no real GitHub org (`bioc`,
  // `bioc-release`) — when we don't have a UUID we still need to remap.
  const map = { 'bioc': 'Bioconductor', 'bioc-release': 'Bioconductor' };
  const login = map[card.ownerLogin] || card.ownerLogin;
  return `https://github.com/${encodeURIComponent(login)}.png?size=460`;
}
