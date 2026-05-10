import fs from 'node:fs';
import path from 'node:path';
import { escapeXml, measureText, truncateToWidth, wrapText } from './util.js';

/* ----------------------------- design tokens ----------------------------- */

const W = 1200;
const H = 630;

const COLORS = {
  bg: '#ffffff',
  bgPanel: '#f6f8fa',     // GitHub-ish soft gray for the logo panel
  rule: '#e4e8ee',
  ink: '#0f1f3a',         // deep navy headline
  inkSoft: '#3a4a66',     // body
  inkMuted: '#6b7a90',    // labels / metadata
  accent: '#3b71ca',      // primary link blue from r-universe.dev
  accentInk: '#1f4a99',
  accentSoft: '#eaf1fb',
  star: '#3b71ca',          // primary blue, matches the site link colour
  rocket: '#0f1f3a',
  flame: '#ff8a3d',         // warm accent for the rocket exhaust
  flameSoft: '#ffd28a',
  ringSoft: '#dfe7f5',      // light blue dashed orbit lines
  badgeBg: '#3b71ca',       // solid accent blue, contrasts cleanly with sky
  badgeInk: '#ffffff',
  badgeMuted: '#6b88b8',    // for the "+N" overflow pill
  // Saturn / r-universe icon colour
  saturn: '#1f4a99',
};

// CSS that pulls Inter from Google Fonts when the SVG is opened in a
// browser. resvg-js ignores `@import` (no network access at render time)
// and uses the local TTFs we pass in via fontFiles instead, so the same
// SVG works for both audiences. Including this string adds ~150 bytes;
// inlining the woff2 instead would add ~245 KB.
const GOOGLE_FONTS_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');`;

// Cached r-universe wordmark SVG (logo-big.svg from r-universe.dev). The
// source carries a small italic "R-universe" sub-text below the main letters
// that's intentionally part of the brand mark. We keep it, recolour every
// white fill to our ink colour, and force its font-family to Inter so it
// renders consistently with the rest of the card. Returns just the inner
// shapes so the caller can position them inside its own <svg>.
let WORDMARK_INNER = null;
function rUniverseWordmark(color) {
  if (WORDMARK_INNER == null) {
    const fp = path.join(import.meta.dirname, '..', 'assets', 'icons', 'logo-big.svg');
    if (!fs.existsSync(fp)) {
      WORDMARK_INNER = '';
    } else {
      let raw = fs.readFileSync(fp, 'utf8')
        .replace(/<\?xml[^?]*\?>/g, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .trim()
        .replace(/^<svg\b[^>]*>/i, '')
        .replace(/<\/svg>\s*$/i, '');
      // The text element's inline style fixes its font to Arial; replace that
      // with Inter so the sub-text rasterises identically across renderers.
      raw = raw.replace(
        /font-family:\s*Arial,\s*Helvetica,\s*sans-serif/gi,
        `font-family: 'Inter', Helvetica, Arial, sans-serif`
      );
      // Namespace IDs so they don't collide with package-logo SVGs that also
      // happen to use short ids like `a` or `b` (e.g. the V8 package logo).
      WORDMARK_INNER = namespaceIds(raw);
    }
  }
  if (!WORDMARK_INNER) return '';
  // Recolour every white fill — both the path fills and the inline style on
  // the sub-text. The source mixes attribute and style forms.
  return WORDMARK_INNER
    .replace(/fill\s*=\s*"(?:white|#fff|#ffffff)"/gi, `fill="${color}"`)
    .replace(/fill\s*=\s*'(?:white|#fff|#ffffff)'/gi, `fill="${color}"`)
    .replace(/fill\s*:\s*white/gi, `fill: ${color}`)
    .replace(/fill\s*:\s*#fff(?:fff)?/gi, `fill: ${color}`)
    .replace(/fill\s*:\s*rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi, `fill: ${color}`);
}

/* ----------------------------- layout helpers ---------------------------- */

const LOGO_PANEL = { x: 80, y: 184, size: 260 };
const TEXT_X_WITH_LOGO = LOGO_PANEL.x + LOGO_PANEL.size + 56;
const TEXT_X_NO_LOGO = 80;
const TEXT_RIGHT = W - 64;

/* ------------------------------ public API ------------------------------ */

/**
 * Build the SVG card.
 *
 * @param {object} card  The output of extractCardData().
 * @param {object} [logo] Optional already-fetched logo; either
 *                        { isSvg:true, svg }  or  { isSvg:false, dataUri }.
 * @returns {string} A standalone SVG document.
 */
export function renderPackageSvg(card, logo) {
  const hasLogo = !!logo;
  const textX = hasLogo ? TEXT_X_WITH_LOGO : TEXT_X_NO_LOGO;
  const textWidth = TEXT_RIGHT - textX;

  /* --- package name --------------------------------------------------- */
  const pkgName = card.package || '';
  const pkgSize = fitSingleLine(pkgName, textWidth, 104, 56, 700);

  /* --- title (up to 2 lines) ------------------------------------------ */
  const titleSize = 30;
  const titleLineHeight = 38;
  const titleLines = wrapText(card.title || '', textWidth, titleSize, 400, 2);

  /* --- maintainer line (small, muted) --------------------------------- */
  let maintainerLine = '';
  if (card.maintainer && card.maintainer.name) {
    maintainerLine = `Maintained by ${card.maintainer.name}`;
    maintainerLine = truncateToWidth(maintainerLine, textWidth, 22, 400);
  }

  /* --- tags (top-right header) --------------------------------------- */
  // Tags are now laid out inside topRightTags(); we only pre-build them here
  // so the call site below stays clean.
  const tagsBlock = topRightTags(card.tags);

  /* --------------------------- y-axis assembly --------------------------- */
  // No eyebrow line; the package name is the first text element after the
  // header. We leave generous space below the name's descenders before the
  // title starts so things never feel cramped.
  let y = 184;
  const pkgBaseline = y + pkgSize * 0.82;
  // Drop below the descender (~0.22 of font-size) plus a small breather.
  y = pkgBaseline + pkgSize * 0.28 + 10;
  const titleBlockY = y;
  y += titleLines.length * titleLineHeight;
  y += 18;
  const maintainerY = y + 18;

  /* ------------------------------- pieces ------------------------------- */
  const pieces = [];

  // Background.
  pieces.push(`<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`);

  // Decorative space scenery (gradient wash, orbital arc, faded rocket,
  // starfield) — covers the entire card. A soft halo sits on top of the
  // scenery, behind the logo, to give the logo a clean white area and to
  // blend opaque-background avatars (github.com/{owner}.png) into the
  // tinted card without leaving a visible rectangular seam.
  pieces.push(spaceScenery());
  if (hasLogo) {
    pieces.push(logoHalo());
  }


  // Header bar (brand mark only — URL has moved to the footer).
  pieces.push(headerStrip());

  // Tag pills now sit in the top-right of the header band.
  pieces.push(tagsBlock);

  // Bottom rule above the footer (URL on the left, stats on the right).
  pieces.push(`<line x1="64" y1="${FOOTER_TOP}" x2="${W - 64}" y2="${FOOTER_TOP}" stroke="${COLORS.rule}" stroke-width="1"/>`);

  // Logo panel.
  if (hasLogo) {
    pieces.push(logoPanel(logo));
  }

  // Package name.
  pieces.push(
    `<text x="${textX}" y="${pkgBaseline}" font-weight="700" font-size="${pkgSize}" fill="#424242" letter-spacing="-2">${escapeXml(pkgName)}</text>`
  );

  // Title — italic, soft ink. We render it with a white stroke painted
  // *under* the fill (paint-order="stroke fill"), which gives every glyph a
  // soft halo so the text stays legible over the (faded) rocket and the
  // tinted scenery behind it.
  titleLines.forEach((line, i) => {
    const ly = titleBlockY + (i + 1) * titleLineHeight - 8;
    pieces.push(
      `<text x="${textX}" y="${ly}" font-weight="400" font-style="italic" font-size="${titleSize}" fill="${COLORS.inkSoft}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke fill">${escapeXml(line)}</text>`
    );
  });

  // Maintainer (small, muted) — same halo trick.
  if (maintainerLine) {
    pieces.push(
      `<text x="${textX}" y="${maintainerY}" font-weight="500" font-size="22" fill="${COLORS.inkMuted}" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke fill">${escapeXml(maintainerLine)}</text>`
    );
  }

  // Footer: URL on the left, stats (★ stars · ↓ dl/mo · 📄 vignettes ·
  // 👥 contributors · 🏷 version) on the right, both at the same baseline.
  pieces.push(footerUrl(card));
  pieces.push(footerStats(card));

  /* ------------------------------ assemble ----------------------------- */
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<style type="text/css"><![CDATA[
${GOOGLE_FONTS_IMPORT}
text { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
]]></style>
<radialGradient id="bgWashRadial" cx="78%" cy="22%" r="80%">
  <stop offset="0%" stop-color="#d8e5f7"/>
  <stop offset="35%" stop-color="#e6eef9" stop-opacity="0.8"/>
  <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
<radialGradient id="bgWashLow" cx="20%" cy="100%" r="60%">
  <stop offset="0%" stop-color="#eaf1fb" stop-opacity="0.55"/>
  <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
<radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#7aa6e8" stop-opacity="0.55"/>
  <stop offset="60%" stop-color="#3b71ca" stop-opacity="0.18"/>
  <stop offset="100%" stop-color="#3b71ca" stop-opacity="0"/>
</radialGradient>
<radialGradient id="planetSoft" cx="35%" cy="32%" r="80%">
  <stop offset="0%" stop-color="#bcd0ec" stop-opacity="0.55"/>
  <stop offset="80%" stop-color="#7aa6e8" stop-opacity="0.20"/>
  <stop offset="100%" stop-color="#3b71ca" stop-opacity="0.10"/>
</radialGradient>
<clipPath id="userAvatarClip">
  <circle cx="${LOGO_PANEL.x + LOGO_PANEL.size / 2}" cy="${LOGO_PANEL.y + LOGO_PANEL.size / 2}" r="${LOGO_PANEL.size / 2}"/>
</clipPath>
</defs>
${pieces.join('\n')}
</svg>`;
}

/**
 * Build the SVG card for a whole r-universe (per org/user landing page),
 * not a single package. Reuses the same chrome (background scenery, header
 * brand mark, bottom-right stats row) but the body shows the universe's
 * display name + bio + a few summary counters.
 *
 * @param {object} uni   Output of extractUniverseData().
 * @param {object} [logo] Already-fetched logo descriptor; same shape as
 *                        used by renderPackageSvg.
 * @returns {string} A standalone SVG document.
 */
export function renderUniverseSvg(uni, logo) {
  const hasLogo = !!logo;
  const textX = hasLogo ? TEXT_X_WITH_LOGO : TEXT_X_NO_LOGO;
  const textWidth = TEXT_RIGHT - textX;

  // Headline: the display name (e.g. "rOpenSci"), auto-shrinks if very wide.
  const name = uni.name || uni.ownerLogin || '';
  const nameSize = fitSingleLine(name, textWidth, 88, 48, 700);

  // Bio wraps to up to 2 italic lines.
  const bioSize = 28;
  const bioLineHeight = 36;
  const bioLines = wrapText(uni.description || '', textWidth, bioSize, 400, 2);

  // Universe URL goes under the bio (the footer-left slot is freed up so
  // the labelled stats can spread across the whole footer width).
  const url = `https://${uni.ownerLogin}.r-universe.dev`;

  // Top topics (the right-side tag row).
  const tagsBlock = topRightTags(uni.tags);

  /* y-axis assembly */
  // Slight nudge up vs the package card so the name + bio + URL block has
  // a touch more breathing room before the footer row.
  let y = 170;
  const nameBaseline = y + nameSize * 0.82;
  y = nameBaseline + nameSize * 0.28 + 10;
  const bioBlockY = y;
  // The URL sits a comfortable line-height below the bio block.
  const urlY = bioBlockY + bioLines.length * bioLineHeight + 32;

  const pieces = [];
  pieces.push(`<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`);
  pieces.push(spaceSceneryUniverse());
  if (hasLogo) pieces.push(logoHalo());
  pieces.push(headerStrip());
  pieces.push(tagsBlock);
  pieces.push(`<line x1="64" y1="${FOOTER_TOP}" x2="${W - 64}" y2="${FOOTER_TOP}" stroke="${COLORS.rule}" stroke-width="1"/>`);
  if (hasLogo) pieces.push(logoPanel(logo));

  // Display name (same colour as a package name).
  pieces.push(
    `<text x="${textX}" y="${nameBaseline}" font-weight="700" font-size="${nameSize}" fill="#424242" letter-spacing="-2">${escapeXml(name)}</text>`
  );

  // Bio (italic, with white halo for legibility over scenery).
  bioLines.forEach((line, i) => {
    const ly = bioBlockY + (i + 1) * bioLineHeight - 8;
    pieces.push(
      `<text x="${textX}" y="${ly}" font-weight="400" font-style="italic" font-size="${bioSize}" fill="${COLORS.inkSoft}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke fill">${escapeXml(line)}</text>`
    );
  });

  // Universe URL line under the bio. No icon; the footer no longer has
  // the URL slot so this is the canonical link.
  pieces.push(
    `<text x="${textX}" y="${urlY}" font-weight="600" font-size="22" fill="${COLORS.inkSoft}" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke fill">${escapeXml(url)}</text>`
  );

  // Footer: labelled stats only — no URL on the left any more.
  pieces.push(footerUniverseStats(uni));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<style type="text/css"><![CDATA[
${GOOGLE_FONTS_IMPORT}
text { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
]]></style>
<radialGradient id="bgWashRadial" cx="78%" cy="22%" r="80%">
  <stop offset="0%" stop-color="#d8e5f7"/>
  <stop offset="35%" stop-color="#e6eef9" stop-opacity="0.8"/>
  <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
<radialGradient id="bgWashLow" cx="20%" cy="100%" r="60%">
  <stop offset="0%" stop-color="#eaf1fb" stop-opacity="0.55"/>
  <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
<radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#7aa6e8" stop-opacity="0.55"/>
  <stop offset="60%" stop-color="#3b71ca" stop-opacity="0.18"/>
  <stop offset="100%" stop-color="#3b71ca" stop-opacity="0"/>
</radialGradient>
<radialGradient id="planetSoft" cx="35%" cy="32%" r="80%">
  <stop offset="0%" stop-color="#bcd0ec" stop-opacity="0.55"/>
  <stop offset="80%" stop-color="#7aa6e8" stop-opacity="0.20"/>
  <stop offset="100%" stop-color="#3b71ca" stop-opacity="0.10"/>
</radialGradient>
<clipPath id="userAvatarClip">
  <circle cx="${LOGO_PANEL.x + LOGO_PANEL.size / 2}" cy="${LOGO_PANEL.y + LOGO_PANEL.size / 2}" r="${LOGO_PANEL.size / 2}"/>
</clipPath>
</defs>
${pieces.join('\n')}
</svg>`;
}

/**
 * Stats row for the universe card: packages · contributors · maintainers
 * · articles · datasets. Same right-to-left layout and visual style as
 * the package card's footerStats — just different items.
 */
function footerUniverseStats(uni) {
  const pluralise = (n, single) =>
    `${formatNumber(n)} ${n === 1 ? single : single + 's'}`;

  const items = [];
  if (uni.packages) items.push({ kind: 'packages', value: pluralise(uni.packages, 'package') });
  // For user-type universes (circle avatar) the "maintainers" count is
  // always 1 — uninteresting. Replace it with the number of organisations
  // the user is involved with, which the /api/summary endpoint also
  // exposes. For org-type universes we keep showing maintainers as before.
  if (uni.ownerIsOrg) {
    if (uni.maintainers) items.push({ kind: 'maintainers', value: pluralise(uni.maintainers, 'maintainer') });
  } else if (uni.organizations) {
    items.push({ kind: 'organizations', value: pluralise(uni.organizations, 'organization') });
  }
  if (uni.contributors) items.push({ kind: 'contributors', value: pluralise(uni.contributors, 'contributor') });
  if (uni.articles)     items.push({ kind: 'articles',     value: pluralise(uni.articles,     'article') });
  if (uni.datasets)     items.push({ kind: 'datasets',     value: pluralise(uni.datasets,     'dataset') });
  if (!items.length) return '';

  const y = FOOTER_Y;
  const fontSize = FOOTER_FONT_SIZE;
  const iconSize = FOOTER_ICON_SIZE;
  const gapInside = 9;
  const gapBetween = 24;

  // The footer URL is gone, so the row spans the full inner width and is
  // distributed evenly. Compute total content width first, then deal it
  // out left-to-right with even gaps.
  const widths = items.map((it) =>
    Math.ceil(measureText(it.value, fontSize, 600)) + gapInside + iconSize,
  );
  const total = widths.reduce((a, b) => a + b, 0);
  const inner = W - 128; // 64 px margin each side
  const gap = items.length > 1 ? Math.max(gapBetween, (inner - total) / (items.length - 1)) : gapBetween;

  const pieces = [];
  let cursor = 64;
  items.forEach((it, i) => {
    pieces.push(statIcon(it.kind, cursor, y - iconSize / 2, iconSize));
    cursor += iconSize + gapInside;
    pieces.push(
      `<text x="${cursor}" y="${y + 7}" font-weight="600" font-size="${fontSize}" fill="${COLORS.ink}">${escapeXml(it.value)}</text>`
    );
    cursor += Math.ceil(measureText(it.value, fontSize, 600));
    if (i < items.length - 1) cursor += gap;
  });
  return `<g class="universe-stats">${pieces.join('')}</g>`;
}

/* ----------------------------- piece builders ---------------------------- */

function headerStrip() {
  const barH = 6;
  // Brand mark: the official r-universe wordmark from logo-big.svg.
  // The source artwork has a viewBox of "1.898 36.315 127.113 41.398", giving
  // an aspect ratio of ~3.07:1. We render it 160 wide → 52 tall.
  const markW = 160, markH = 52;
  const markX = 60, markY = 28;
  const wordmark = `
    <svg x="${markX}" y="${markY}" width="${markW}" height="${markH}" viewBox="1.898 36.315 127.113 41.398" preserveAspectRatio="xMidYMid meet">
      ${rUniverseWordmark('#424242')}
    </svg>`;
  return `
    <rect x="0" y="0" width="${W}" height="${barH}" fill="${COLORS.accent}"/>
    ${wordmark}
  `;
}

/**
 * Tag row for the upper-right corner of the card. Right-aligned so it always
 * sits cleanly against the card edge, regardless of how many tags fit. Uses
 * a maximum width so it never crashes into the wordmark.
 */
function topRightTags(tags) {
  const maxWidth = W - 64 - 250; // leave room past the wordmark on the left
  const layout = layoutTags(tags, maxWidth);
  if (!layout.length) return '';
  // Compute the total layout width (pill widths + gaps).
  const gap = 10;
  let total = 0;
  layout.forEach((p, i) => { total += p.w + (i ? gap : 0); });
  // Vertical: aligned with the wordmark's vertical centre (y ≈ 54).
  const cy = 54;
  let cursor = W - 64 - total;
  const out = [];
  layout.forEach((p) => {
    out.push(pill(cursor, cy - p.h / 2, p.w, p.h, p.text));
    cursor += p.w + gap;
  });
  return `<g class="top-tags">${out.join('')}</g>`;
}

/**
 * URL footer on the bottom-left, mirroring the icon + value pattern of the
 * stats row on the right (globe icon + url, font-weight 600, ink colour).
 */
function footerUrl(card) {
  const universe = card.ownerLogin || '';
  const url = `https://${universe ? universe + '.' : ''}r-universe.dev` +
              (card.package ? `/${card.package}` : '');
  // Same anchor maths used in footerStats so both sides of the footer line
  // up. y is the row's vertical anchor: icons sit at y - 10 (top of a
  // 20-tall glyph) and text baselines at y + 7.
  const y = FOOTER_Y;
  const iconX = 64;
  const gapInside = 9;
  const iconSize = FOOTER_ICON_SIZE;
  const textX = iconX + iconSize + gapInside;
  return `
    ${statIcon('globe', iconX, y - iconSize / 2, iconSize)}
    <text x="${textX}" y="${y + 7}" font-weight="600" font-size="${FOOTER_FONT_SIZE}" fill="${COLORS.ink}">${escapeXml(url)}</text>
  `;
}

function logoPanel(logo) {
  const { x, y, size } = LOGO_PANEL;
  // No background panel, no border: the image sits directly on the white card.
  // Most package logos are transparent or already white-backed; org avatars
  // are kept square (they're the organisation's brand mark); user avatars
  // (when we fall back to github.com/{login}.png for a personal universe)
  // are cropped to a circle to match the convention for user profiles.
  let img;
  if (logo.isSvg) {
    img = `<g transform="translate(${x},${y})">${inlineSvgScaled(logo.svg, size, size)}</g>`;
  } else if (logo.isUserAvatar) {
    // slice (rather than meet) so the avatar fills the circle even if the
    // source isn't perfectly square. Add a thin ring for definition.
    const cx = x + size / 2, cy = y + size / 2, r = size / 2;
    img = `
      <image x="${x}" y="${y}" width="${size}" height="${size}"
             preserveAspectRatio="xMidYMid slice"
             xlink:href="${logo.dataUri}"
             clip-path="url(#userAvatarClip)"/>
      <circle cx="${cx}" cy="${cy}" r="${r - 0.5}" fill="none"
              stroke="${COLORS.rule}" stroke-width="1.5"/>`;
  } else {
    img = `<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" xlink:href="${logo.dataUri}"/>`;
  }
  return img;
}

// Counter used to generate a unique prefix per inlined SVG so internal
// references (clip-path, gradients, masks, <use>) stay self-contained and
// don't collide with IDs from other inlined SVGs in the same document.
// Browsers scope IDs document-wide, so without prefixing, e.g. the V8 logo
// and the r-universe wordmark — which both happen to use `id="a"` and
// `id="b"` — would step on each other.
let inlineCounter = 0;

function inlineSvgScaled(svgText, w, h) {
  let s = svgText.replace(/<\?xml[^?]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').trim();
  s = namespaceIds(s);
  s = s.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    // Strip any attribute we want to set ourselves; otherwise the source
    // SVG's value plus our value would collide and resvg refuses to parse
    // (cran's CRANlogo.svg, for example, ships its own preserveAspectRatio).
    let cleaned = attrs
      .replace(/\swidth="[^"]*"/gi, '')
      .replace(/\sheight="[^"]*"/gi, '')
      .replace(/\spreserveAspectRatio="[^"]*"/gi, '');
    return `<svg${cleaned} width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet">`;
  });
  return s;
}

/**
 * Rewrite every `id="x"` to `id="<prefix>x"` and every reference to that id
 * (`url(#x)`, `href="#x"`, `xlink:href="#x"`) to match. Returns a string
 * with internally-consistent but globally-unique ids, safe to drop into a
 * larger SVG document alongside other inlined fragments.
 */
function namespaceIds(svgText) {
  const prefix = `i${++inlineCounter}-`;
  return svgText
    .replace(/\bid="([^"]+)"/g, (m, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${prefix}${id})`)
    .replace(/(xlink:)?href="#([^"]+)"/g, (m, xl, id) => `${xl || ''}href="#${prefix}${id}"`);
}

/* ------------------------------ space scenery ------------------------------ */

/**
 * The decorative back layer. Includes:
 *  - a gradient wash in the upper-right corner
 *  - a thin orbital arc that sweeps behind the title
 *  - a stylised planet (with a ring) in the upper-right
 *  - a rocket flying diagonally upward, leaving a trail of dots
 *  - a sparse field of varied stars across the top half of the card
 *
 * Everything here uses opacity, so the foreground content always wins.
 */
function spaceScenery() {
  // Two-layer wash: a stronger upper-right plume and a soft lower-left fill
  // so the whole card reads as a soft sky fading to white.
  const washUpper = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgWashRadial)"/>`;
  const washLower = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgWashLow)"/>`;

  // A small, very faint planet tucked in the lower-right behind the rocket.
  // Its outline + a thin ring give the card extra depth without adding a
  // strong second focal point.
  const planet = backgroundPlanet(W - 95, H - 165, 78);

  // Two concentric orbital arcs that imply a flight path. The inner arc
  // wraps the rocket; the outer one extends past the card edge to suggest
  // motion. Both very subtle.
  const arcs = `
    <path d="M 380 460 Q 760 140 ${W + 30} 90"
          fill="none" stroke="${COLORS.ringSoft}" stroke-width="1.5"
          stroke-dasharray="2 6" opacity="0.85"/>
    <path d="M 540 580 Q 900 250 ${W + 30} 200"
          fill="none" stroke="${COLORS.ringSoft}" stroke-width="1.2"
          stroke-dasharray="1 7" opacity="0.55"/>
    <ellipse cx="${W - 95}" cy="${H - 165}" rx="170" ry="40"
             fill="none" stroke="${COLORS.ringSoft}" stroke-width="1.2"
             stroke-dasharray="2 5" opacity="0.6"
             transform="rotate(-18 ${W - 95} ${H - 165})"/>
  `;

  // Cartoon rocket: faded but colourful (white body, red nose & fins, blue
  // porthole, layered orange-yellow flame). The new shape is taller than
  // the old silhouette so we use a smaller scale to keep it from crashing
  // into the header or the footer.
  const rocket = rocketGroup(W - 240, 320, 1.95, -22);

  // Smaller accents in the same cartoon style. Positioned in the empty
  // zones — away from the rocket, the planet, and the foreground content —
  // to add a bit of variety without clutter.
  const ufo = cartoonUFO(700, 140, 1.85, -8);
  const satellite = cartoonSatellite(1135, 230, 1.65, 18);
  const comet = cartoonComet(490, 510, 1.6, -22);

  // Stars field.
  const stars = starsField();

  return `<g class="scenery">${washUpper}${washLower}${planet}${arcs}${rocket}${ufo}${satellite}${comet}${stars}</g>`;
}

/**
 * Background scenery for the universe card. Same cartoon-faded style as
 * spaceScenery() — same wash, same starfield — but the focal cast is
 * different so a universe card doesn't look like a package card by
 * accident. The rocket is replaced by an astronaut, the saturn-y planet
 * by an Earth, and the satellite by a small space station.
 */
function spaceSceneryUniverse() {
  const washUpper = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgWashRadial)"/>`;
  const washLower = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgWashLow)"/>`;

  // Saturn at the top with a tilted ring, anchored upper-right. Kept small
  // so it reads as a distant body rather than competing with the astronaut.
  const saturn = cartoonSaturn(W - 120, 130, 40);

  // A subtle dashed orbit arc that the astronaut appears to be tethered to.
  const arcs = `
    <path d="M 380 500 Q 760 200 ${W + 30} 110"
          fill="none" stroke="${COLORS.ringSoft}" stroke-width="1.5"
          stroke-dasharray="2 6" opacity="0.85"/>
  `;

  // The astronaut is the main figure on the right, in a more dynamic
  // floating pose (one arm raised, body tilted).
  const astronaut = cartoonAstronaut(W - 240, 330, 1.95, -14);

  // A little background rocket pointing right, tucked into the empty space
  // between the wordmark and the astronaut so it doesn't overlap the title.
  const rocket = rocketGroup(540, 130, 0.65, 92);

  // Lower-mid: a cartoon flying saucer with a cute green alien (round head,
  // two antennae). Moved up-right so it clears the footer text, and faded
  // a bit more than before so it stays scenery rather than a focal point.
  const alien = alienUFO(540, 470, 2.4, -8);

  const stars = starsField();

  return `<g class="scenery">${washUpper}${washLower}${saturn}${arcs}${rocket}${astronaut}${alien}${stars}</g>`;
}

/**
 * Tiny cartoon UFO. Native size ~50 wide × 24 tall, centred at (0, 0).
 * Saucer body in light gray, blue dome, red rim band, three glowing lights
 * underneath. Same outline weight as the rocket so they read as a set.
 */
function cartoonUFO(cx, cy, scale = 1, rotate = 0) {
  return `
    <g class="bg-ufo" opacity="0.42"
       transform="translate(${cx},${cy}) rotate(${rotate}) scale(${scale})">
      <!-- saucer body (oval) -->
      <ellipse cx="0" cy="2" rx="22" ry="5"
               fill="#c5ccd6" stroke="#0f1f3a" stroke-width="1.4"/>
      <!-- red rim band underneath -->
      <path d="M -19 5 Q 0 11 19 5 L 16 8 Q 0 13 -16 8 Z"
            fill="#e74c4c" stroke="#0f1f3a" stroke-width="1.2" stroke-linejoin="round"/>
      <!-- glass dome -->
      <path d="M -10 -1 A 10 9 0 0 1 10 -1 Z"
            fill="#7aa6e8" stroke="#0f1f3a" stroke-width="1.4" stroke-linejoin="round"/>
      <!-- dome highlight -->
      <path d="M -7 -2 Q -4 -7 1 -7" fill="none"
            stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>
      <!-- underside lights -->
      <circle cx="-12" cy="9" r="1.4" fill="#ffd28a"/>
      <circle cx="0" cy="10" r="1.5" fill="#fff6d8"/>
      <circle cx="12" cy="9" r="1.4" fill="#ffd28a"/>
    </g>`;
}

/**
 * Tiny cartoon satellite. Native size ~46 wide × 22 tall (excluding antenna),
 * centred at (0, 0). Central body with two solar-panel wings and a small
 * antenna with a red blinker.
 */
function cartoonSatellite(cx, cy, scale = 1, rotate = 0) {
  return `
    <g class="bg-satellite" opacity="0.42"
       transform="translate(${cx},${cy}) rotate(${rotate}) scale(${scale})">
      <!-- left solar panel -->
      <rect x="-22" y="-4" width="11" height="8"
            fill="#7aa6e8" stroke="#0f1f3a" stroke-width="1.2"/>
      <line x1="-18.5" y1="-4" x2="-18.5" y2="4" stroke="#0f1f3a" stroke-width="0.7"/>
      <line x1="-15" y1="-4" x2="-15" y2="4" stroke="#0f1f3a" stroke-width="0.7"/>
      <!-- right solar panel -->
      <rect x="11" y="-4" width="11" height="8"
            fill="#7aa6e8" stroke="#0f1f3a" stroke-width="1.2"/>
      <line x1="14.5" y1="-4" x2="14.5" y2="4" stroke="#0f1f3a" stroke-width="0.7"/>
      <line x1="18" y1="-4" x2="18" y2="4" stroke="#0f1f3a" stroke-width="0.7"/>
      <!-- main body -->
      <rect x="-8" y="-5" width="16" height="10" rx="2"
            fill="#ffffff" stroke="#0f1f3a" stroke-width="1.5"/>
      <!-- body porthole -->
      <circle cx="0" cy="0" r="2.4" fill="#1f4a99"/>
      <circle cx="-0.7" cy="-0.7" r="0.9" fill="#ffffff" opacity="0.8"/>
      <!-- antenna -->
      <line x1="0" y1="-5" x2="0" y2="-12" stroke="#0f1f3a" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="0" cy="-13" r="1.4" fill="#e74c4c" stroke="#0f1f3a" stroke-width="0.8"/>
    </g>`;
}

/**
 * A small cartoon comet / fireball. The head is a layered yellow-orange
 * fireball; the trail is a soft fading streak that points opposite to the
 * direction of travel (so a positive `rotate` of 0 means trail extending
 * to the left).
 */
function cartoonComet(cx, cy, scale = 1, rotate = 0) {
  return `
    <g class="bg-comet" opacity="0.45"
       transform="translate(${cx},${cy}) rotate(${rotate}) scale(${scale})">
      <!-- trail: layered streaks for a soft glow effect -->
      <path d="M -2 -3 Q -28 -2 -42 0 Q -28 2 -2 3 Z"
            fill="#ffd28a" opacity="0.55"/>
      <path d="M -2 -2 Q -22 -1 -34 0 Q -22 1 -2 2 Z"
            fill="#ff8a3d" opacity="0.7"/>
      <!-- head -->
      <circle cx="0" cy="0" r="7" fill="#ffd28a"/>
      <circle cx="0" cy="0" r="4.5" fill="#ff8a3d"/>
      <circle cx="-1.2" cy="-1.6" r="2" fill="#fff6d8"/>
      <!-- thin outline so it reads with the rest -->
      <circle cx="0" cy="0" r="7" fill="none" stroke="#0f1f3a" stroke-width="1.2"/>
    </g>`;
}

/**
 * A very subtle planet — soft fill + thin orbital ring — sized to feel like
 * a distant body rather than competing for attention.
 */
function backgroundPlanet(cx, cy, r) {
  return `
    <g class="bg-planet">
      <ellipse cx="${cx}" cy="${cy}" rx="${r * 1.55}" ry="${r * 0.32}"
               fill="none" stroke="${COLORS.accent}" stroke-width="1.2"
               stroke-dasharray="3 6" opacity="0.32"
               transform="rotate(-22 ${cx} ${cy})"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#planetSoft)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
              stroke="${COLORS.accent}" stroke-width="1" opacity="0.18"/>
    </g>`;
}

/**
 * A cartoon astronaut in a dynamic floating pose — body tilted, one arm
 * raised giving a thumbs-up, legs slightly splayed. Same line-and-fill
 * style as the rest of the cartoon scenery. The whole figure is wrapped
 * in a -16° rotation by default to read as "drifting in zero-G" rather
 * than standing still; pass `rotate` to override.
 */
function cartoonAstronaut(cx, cy, scale = 1.5, rotate = -16) {
  const C = {
    suit: '#ffffff',
    pack: '#cfd5dd',
    line: '#0f1f3a',
    visor: '#1f4a99',
    visorGlass: '#5a8fd8',
    visorHi: '#ffffff',
    accent: '#e74c4c',
    blink: '#ffd28a',
    boot: '#0f1f3a',
    glove: '#dde2ea',
    tether: '#9aa3b1',
  };
  return `
    <g class="bg-astronaut" opacity="0.22"
       transform="translate(${cx},${cy}) rotate(${rotate}) scale(${scale})">
      <!-- tether attached to the astronaut's right side, curving out and
           continuing well past the figure so it appears to lead off-canvas
           to something we can't see (mothership, station, etc.). -->
      <path d="M 22 14 C 56 4 96 22 150 56" fill="none"
            stroke="${C.tether}" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>
      <!-- backpack (slightly visible behind the torso) -->
      <rect x="-26" y="-2" width="52" height="46" rx="6"
            fill="${C.pack}" stroke="${C.line}" stroke-width="1.5"/>
      <rect x="-18" y="6" width="6" height="3" fill="${C.accent}"/>
      <rect x="12" y="6" width="6" height="3" fill="${C.visor}"/>
      <!-- left arm: bent across the chest -->
      <path d="M -24 6 Q -42 14 -46 32 Q -42 40 -34 40 Q -24 38 -22 30 L -22 12 Z"
            fill="${C.suit}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- left glove (cuff + fist) -->
      <circle cx="-37" cy="36" r="6" fill="${C.glove}" stroke="${C.line}" stroke-width="1.4"/>
      <!-- right arm: raised up giving a thumbs-up -->
      <path d="M 22 4 Q 38 -10 46 -34 Q 50 -42 44 -46 Q 36 -48 30 -42 L 22 -8 Z"
            fill="${C.suit}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- right glove + thumb -->
      <circle cx="42" cy="-44" r="7" fill="${C.glove}" stroke="${C.line}" stroke-width="1.4"/>
      <path d="M 47 -52 Q 51 -55 49 -49 Q 47 -46 45 -47 Z"
            fill="${C.glove}" stroke="${C.line}" stroke-width="1.2"/>
      <!-- suit body / torso (slight curve, narrows at waist) -->
      <path d="M -22 -2 Q -26 28 -18 50 H 18 Q 26 28 22 -2 Z"
            fill="${C.suit}" stroke="${C.line}" stroke-width="1.7" stroke-linejoin="round"/>
      <!-- chest control panel -->
      <rect x="-12" y="10" width="24" height="12" rx="2"
            fill="${C.line}" opacity="0.55"/>
      <circle cx="-6" cy="16" r="1.8" fill="${C.accent}"/>
      <circle cx="0" cy="16" r="1.8" fill="${C.blink}"/>
      <circle cx="6" cy="16" r="1.8" fill="${C.visorGlass}"/>
      <!-- belt -->
      <rect x="-19" y="44" width="38" height="6" fill="${C.line}" opacity="0.55"/>
      <!-- left leg: bent slightly outward -->
      <path d="M -16 50 Q -22 70 -28 90 Q -22 96 -14 92 Q -8 76 -6 50 Z"
            fill="${C.suit}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- right leg: kicked out to the side -->
      <path d="M 6 50 Q 14 72 24 88 Q 30 90 32 84 Q 22 60 16 50 Z"
            fill="${C.suit}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- boots -->
      <ellipse cx="-22" cy="92" rx="9" ry="4" fill="${C.boot}"/>
      <ellipse cx="28" cy="86" rx="8" ry="4" fill="${C.boot}" transform="rotate(20 28 86)"/>
      <!-- helmet -->
      <circle cx="0" cy="-26" r="26" fill="${C.suit}" stroke="${C.line}" stroke-width="1.8"/>
      <!-- visor outer ring -->
      <ellipse cx="0" cy="-26" rx="19" ry="15" fill="${C.visor}"/>
      <!-- visor glass -->
      <ellipse cx="0" cy="-27" rx="16" ry="12.5" fill="${C.visorGlass}"/>
      <!-- visor highlight -->
      <ellipse cx="-6" cy="-32" rx="6" ry="3.2" fill="${C.visorHi}" opacity="0.9"/>
      <ellipse cx="8" cy="-22" rx="2" ry="1.2" fill="${C.visorHi}" opacity="0.55"/>
      <!-- helmet antenna with red blinker -->
      <line x1="-6" y1="-50" x2="-10" y2="-58" stroke="${C.line}"
            stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="-11" cy="-59" r="2.2" fill="${C.accent}" stroke="${C.line}" stroke-width="0.8"/>
      <!-- shoulder blinker -->
      <circle cx="-22" cy="2" r="1.7" fill="${C.blink}" opacity="0.95"/>
    </g>`;
}

/**
 * A small stylised Earth — blue ocean disc with a couple of green continent
 * blobs and a thin orbit ring. Sized to fit where the package card's
 * generic backgroundPlanet sits, so the universe card has a recognisable
 * but not-the-same focal sphere.
 */
function cartoonEarth(cx, cy, r) {
  const ocean = '#5a99e7';
  const land = '#3aa66a';
  const cloud = '#ffffff';
  return `
    <g class="bg-earth" opacity="0.42">
      <!-- subtle orbit ring -->
      <ellipse cx="${cx}" cy="${cy}" rx="${r * 1.55}" ry="${r * 0.32}"
               fill="none" stroke="${COLORS.accent}" stroke-width="1.2"
               stroke-dasharray="3 6" opacity="0.35"
               transform="rotate(-22 ${cx} ${cy})"/>
      <!-- ocean -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${ocean}"/>
      <!-- continents (a couple of irregular blobs) -->
      <path d="M ${cx - 0.55 * r} ${cy - 0.2 * r}
               q ${0.2 * r} ${-0.3 * r} ${0.45 * r} ${-0.1 * r}
               q ${0.1 * r} ${0.18 * r} ${-0.05 * r} ${0.28 * r}
               q ${-0.25 * r} ${0.15 * r} ${-0.4 * r} ${0.05 * r}
               q ${-0.18 * r} ${-0.1 * r} ${-0.15 * r} ${-0.23 * r} z"
            fill="${land}"/>
      <path d="M ${cx + 0.05 * r} ${cy + 0.1 * r}
               q ${0.18 * r} ${-0.15 * r} ${0.4 * r} ${-0.05 * r}
               q ${0.12 * r} ${0.18 * r} ${-0.05 * r} ${0.32 * r}
               q ${-0.2 * r} ${0.18 * r} ${-0.4 * r} ${0.05 * r}
               q ${-0.08 * r} ${-0.18 * r} ${0.05 * r} ${-0.32 * r} z"
            fill="${land}"/>
      <!-- a small white cloud for character -->
      <ellipse cx="${cx - 0.2 * r}" cy="${cy + 0.4 * r}" rx="${0.25 * r}" ry="${0.08 * r}"
               fill="${cloud}" opacity="0.6"/>
      <!-- thin outline -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
              stroke="${COLORS.accent}" stroke-width="1" opacity="0.25"/>
    </g>`;
}

/**
 * A small craters-and-glow moon, used as a tertiary accent on the universe
 * card so the right-hand side has a third element besides the astronaut
 * and the earth.
 */
/**
 * A classic Saturn-with-rings — proper "ring goes behind, planet body
 * over it, then the front of the ring covers the lower half" stack so it
 * reads as a 3-D ringed body rather than a flat disc with a line through
 * it. Used as the upper-area focal piece on the universe card.
 */
function cartoonSaturn(cx, cy, r) {
  const body = '#e8a55a';
  const bodyDark = '#b97633';
  const band = '#d68a3c';
  const ringOuter = '#cba26c';
  const ringInner = '#f0d49b';
  const line = '#0f1f3a';
  const tilt = -22;
  return `
    <g class="bg-saturn" opacity="0.32"
       transform="rotate(${tilt} ${cx} ${cy})">
      <!-- back half of the ring (the part that goes behind the planet) -->
      <path d="M ${cx - r * 1.85} ${cy} A ${r * 1.85} ${r * 0.42} 0 0 1 ${cx + r * 1.85} ${cy}"
            fill="none" stroke="${ringOuter}" stroke-width="${r * 0.18}" stroke-linecap="round"/>
      <path d="M ${cx - r * 1.55} ${cy} A ${r * 1.55} ${r * 0.34} 0 0 1 ${cx + r * 1.55} ${cy}"
            fill="none" stroke="${ringInner}" stroke-width="${r * 0.07}" stroke-linecap="round"/>
      <!-- planet body -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${body}" stroke="${line}" stroke-width="1.6"/>
      <!-- darker bands across the planet for the gas-giant look -->
      <ellipse cx="${cx}" cy="${cy - r * 0.25}" rx="${r * 0.95}" ry="${r * 0.08}"
               fill="${band}" opacity="0.55"/>
      <ellipse cx="${cx}" cy="${cy + r * 0.05}" rx="${r * 0.99}" ry="${r * 0.07}"
               fill="${bodyDark}" opacity="0.45"/>
      <ellipse cx="${cx}" cy="${cy + r * 0.4}" rx="${r * 0.85}" ry="${r * 0.06}"
               fill="${band}" opacity="0.5"/>
      <!-- subtle highlight on upper-left -->
      <ellipse cx="${cx - r * 0.35}" cy="${cy - r * 0.45}" rx="${r * 0.25}" ry="${r * 0.12}"
               fill="#ffffff" opacity="0.25"/>
      <!-- front half of the ring (covers the lower portion of the planet) -->
      <path d="M ${cx - r * 1.85} ${cy} A ${r * 1.85} ${r * 0.42} 0 0 0 ${cx + r * 1.85} ${cy}"
            fill="none" stroke="${ringOuter}" stroke-width="${r * 0.18}" stroke-linecap="round"/>
      <path d="M ${cx - r * 1.55} ${cy} A ${r * 1.55} ${r * 0.34} 0 0 0 ${cx + r * 1.55} ${cy}"
            fill="none" stroke="${ringInner}" stroke-width="${r * 0.07}" stroke-linecap="round"/>
    </g>`;
}

function cartoonMoon(cx, cy, r) {
  const body = '#dde2ea';
  const crater = '#b6bdc8';
  return `
    <g class="bg-moon" opacity="0.55">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${body}" stroke="#0f1f3a" stroke-width="1.2"/>
      <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.2}" r="${r * 0.18}" fill="${crater}"/>
      <circle cx="${cx + r * 0.4}" cy="${cy + r * 0.1}" r="${r * 0.12}" fill="${crater}"/>
      <circle cx="${cx - r * 0.15}" cy="${cy + r * 0.4}" r="${r * 0.1}" fill="${crater}"/>
    </g>`;
}

/**
 * Cartoon flying saucer with a friendly green alien at the controls. The
 * alien is a round head with two antennae (each a thin stalk + small ball),
 * round button eyes and a small smile — the classic kids'-book look rather
 * than the bulbous big-head Roswell stereotype. Native footprint ~140 × 90
 * (centred at 0, 0).
 */
function alienUFO(cx, cy, scale = 1, rotate = 0) {
  const C = {
    saucer: '#c5ccd6',
    line: '#0f1f3a',
    dome: '#7aa6e8',
    domeHi: '#ffffff',
    rim: '#e74c4c',
    light: '#ffd28a',
    head: '#7ec850',
    headShade: '#4f9a30',
    headHi: '#bfe890',
    eye: '#ffffff',
    pupil: '#0f1f3a',
    grin: '#0f1f3a',
    cheek: '#ff8a8a',
    beam: '#fff6d8',
  };
  return `
    <g class="bg-alien-ufo" opacity="0.30"
       transform="translate(${cx},${cy}) rotate(${rotate}) scale(${scale})">
      <!-- soft tractor-beam cone underneath -->
      <path d="M -26 16 L -54 44 L 54 44 L 26 16 Z"
            fill="${C.beam}" opacity="0.5"/>
      <!-- saucer body (oval) -->
      <ellipse cx="0" cy="10" rx="62" ry="12"
               fill="${C.saucer}" stroke="${C.line}" stroke-width="1.7"/>
      <!-- red rim band underneath -->
      <path d="M -54 16 Q 0 28 54 16 L 44 22 Q 0 30 -44 22 Z"
            fill="${C.rim}" stroke="${C.line}" stroke-width="1.4" stroke-linejoin="round"/>
      <!-- glass dome on top -->
      <path d="M -30 8 A 30 28 0 0 1 30 8 Z"
            fill="${C.dome}" stroke="${C.line}" stroke-width="1.7" stroke-linejoin="round"/>
      <!-- dome highlight -->
      <path d="M -22 2 Q -16 -14 -2 -20" fill="none"
            stroke="${C.domeHi}" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>

      <!-- alien antennae (two stalks with small balls) -->
      <line x1="-7" y1="-12" x2="-12" y2="-22"
            stroke="${C.line}" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="-12" cy="-23.5" r="2.4" fill="${C.head}" stroke="${C.line}" stroke-width="1"/>
      <line x1="7" y1="-12" x2="12" y2="-22"
            stroke="${C.line}" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="12" cy="-23.5" r="2.4" fill="${C.head}" stroke="${C.line}" stroke-width="1"/>

      <!-- alien round head -->
      <circle cx="0" cy="-2" r="14"
              fill="${C.head}" stroke="${C.line}" stroke-width="1.7"/>
      <!-- subtle head shading on lower-right -->
      <path d="M 4 -10 A 14 14 0 0 1 -2 12 Q 14 8 14 -2 Q 14 -8 10 -12 Z"
            fill="${C.headShade}" opacity="0.45"/>
      <!-- head highlight upper-left -->
      <ellipse cx="-6" cy="-10" rx="4" ry="2" fill="${C.headHi}" opacity="0.7"/>

      <!-- round button eyes -->
      <circle cx="-5" cy="-3" r="3.2" fill="${C.eye}" stroke="${C.line}" stroke-width="1"/>
      <circle cx="5" cy="-3" r="3.2" fill="${C.eye}" stroke="${C.line}" stroke-width="1"/>
      <circle cx="-5" cy="-2" r="1.6" fill="${C.pupil}"/>
      <circle cx="5" cy="-2" r="1.6" fill="${C.pupil}"/>

      <!-- small grin and cheek dots -->
      <path d="M -4 5 Q 0 9 4 5" fill="none"
            stroke="${C.grin}" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="-9" cy="3" r="1.4" fill="${C.cheek}" opacity="0.8"/>
      <circle cx="9" cy="3" r="1.4" fill="${C.cheek}" opacity="0.8"/>

      <!-- arms reaching to the dome rim -->
      <path d="M -12 8 Q -22 12 -28 10" fill="none"
            stroke="${C.head}" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M 12 8 Q 22 12 28 10" fill="none"
            stroke="${C.head}" stroke-width="3.2" stroke-linecap="round"/>

      <!-- under-saucer lights -->
      <circle cx="-40" cy="22" r="2.4" fill="${C.light}"/>
      <circle cx="-20" cy="24" r="2.6" fill="${C.light}"/>
      <circle cx="0" cy="25" r="2.8" fill="${C.light}"/>
      <circle cx="20" cy="24" r="2.6" fill="${C.light}"/>
      <circle cx="40" cy="22" r="2.4" fill="${C.light}"/>
    </g>`;
}

/**
 * A soft white "glow" sitting on top of the scenery, behind the logo image.
 * It serves two purposes:
 *   1. Provides a clean white area for the logo, so transparent-PNG logos
 *      don't show the tinted background behind them.
 *   2. Hides the rectangular edge of opaque-background logos (notably owner
 *      avatars from github.com/{login}.png) by feathering the surrounding
 *      area to white over a 100-px-or-so falloff, so the logo blends in
 *      without a visible square boundary.
 *
 * Implemented as a stack of concentric rounded rectangles with growing
 * opacity, which renders consistently across renderers without relying on
 * SVG filter support.
 */
function logoHalo() {
  const { x, y, size } = LOGO_PANEL;
  const layers = [
    { off: 120, op: 0.06, rx: 60 },
    { off:  90, op: 0.14, rx: 48 },
    { off:  65, op: 0.26, rx: 38 },
    { off:  45, op: 0.42, rx: 30 },
    { off:  30, op: 0.62, rx: 24 },
    { off:  18, op: 0.82, rx: 18 },
    { off:   8, op: 0.95, rx: 12 },
    { off:   0, op: 1.00, rx:  8 },
  ];
  return layers.map(({ off, op, rx }) => (
    `<rect x="${x - off}" y="${y - off}" ` +
    `width="${size + off * 2}" height="${size + off * 2}" ` +
    `rx="${rx}" ry="${rx}" fill="#ffffff" opacity="${op}"/>`
  )).join('');
}

function starsField() {
  // Deterministic pseudo-random placement for reproducibility — the same
  // package always renders the same starfield.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // We split the work into three layers, drawn in this order:
  //   1. dust:    very small, low-opacity points spread across the whole card
  //   2. stars:   medium-sized brighter dots
  //   3. features: a handful of bright "named" stars with a soft glow halo
  //
  // Each layer respects the same exclusion zones: the area where the package
  // name and title live (so they stay legible) and the rocket's body (so the
  // rocket silhouette stays clean even though it's faded).
  // Tight bbox around the visible rocket silhouette so we don't sprinkle
  // bright stars on top of the (faded) rocket body.
  const inRocketBox = (x, y) => x > 800 && x < 1140 && y > 130 && y < 540;
  const inHeadingZone = (x, y) => x < 760 && y > 170 && y < 380;
  const inHeaderArea = (x, y) => y < 90;
  const skip = (x, y) => inRocketBox(x, y) || inHeadingZone(x, y) || inHeaderArea(x, y);

  const dust = [];
  for (let i = 0; i < 220; i++) {
    const x = 16 + rand() * (W - 32);
    const y = 80 + rand() * (H - 160);
    if (skip(x, y)) continue;
    const r = 0.7 + rand() * 0.8;
    const op = (0.12 + rand() * 0.22).toFixed(2);
    dust.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${COLORS.star}" opacity="${op}"/>`);
  }

  const stars = [];
  for (let i = 0; i < 80; i++) {
    const x = 40 + rand() * (W - 80);
    const y = 90 + rand() * (H - 180);
    if (skip(x, y)) continue;
    const r = rand() < 0.7 ? 1.4 : 2.0;
    const op = (0.32 + rand() * 0.35).toFixed(2);
    stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${COLORS.star}" opacity="${op}"/>`);
  }

  // Hand-placed feature stars with soft halos, distributed to balance the
  // composition. Placements avoid the rocket body and the heading zone.
  const features = [
    { x: 800, y: 120, r: 3.4 },
    { x: 1100, y: 110, r: 3.0 },
    { x: 1180, y: 210, r: 2.4 },
    { x: 700, y: 210, r: 2.6 },
    { x: 460, y: 510, r: 2.6 },
    { x: 660, y: 460, r: 3.0 },
    { x: 1130, y: 480, r: 2.6 },
    { x: 1180, y: 580, r: 2.0 },
  ];
  const haloed = features.map((f) => `
    <circle cx="${f.x}" cy="${f.y}" r="${f.r * 4.5}" fill="url(#starGlow)" opacity="0.55"/>
    <circle cx="${f.x}" cy="${f.y}" r="${f.r}" fill="${COLORS.star}" opacity="0.95"/>`).join('');

  // 4-point "twinkles" for an extra bit of sparkle.
  const twinkles = [
    { x: 760, y: 100, s: 7 },
    { x: 1180, y: 150, s: 5 },
    { x: 600, y: 380, s: 5 },
    { x: 980, y: 580, s: 5 },
  ];
  const twinkled = twinkles
    .filter((t) => !inRocketBox(t.x, t.y))
    .map((t) => starGlyph(t.x, t.y, t.s, COLORS.accent, 0.5))
    .join('');

  return dust.join('') + stars.join('') + haloed + twinkled;
}

function starGlyph(cx, cy, s, color, opacity) {
  // 4-point sparkle.
  const d = `M ${cx} ${cy - s} L ${cx + s * 0.25} ${cy - s * 0.25} L ${cx + s} ${cy} L ${cx + s * 0.25} ${cy + s * 0.25} L ${cx} ${cy + s} L ${cx - s * 0.25} ${cy + s * 0.25} L ${cx - s} ${cy} L ${cx - s * 0.25} ${cy - s * 0.25} Z`;
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}

/**
 * A cartoon-style rocket used as a faded background graphic. Drawn in its
 * own coordinate system centred at (0, 0) with the nose pointing up, so the
 * caller controls position and rotation cleanly. Colours intentionally pop
 * (red nose + fins, blue porthole, layered orange-yellow flame) but the
 * whole group sits at a low opacity so the rocket reads as scenery rather
 * than a foreground graphic.
 *
 * @param {number} cx     centre x in card coordinates
 * @param {number} cy     centre y in card coordinates
 * @param {number} scale  uniform scale (1 ≈ 110 wide × 200 tall native)
 * @param {number} rotate degrees, negative = ccw
 */
function rocketGroup(cx, cy, scale = 1.5, rotate = -22) {
  const C = {
    body: '#ffffff',
    nose: '#e74c4c',
    fin: '#e74c4c',
    line: '#0f1f3a',
    windowOuter: '#1f4a99',
    windowGlass: '#7aa6e8',
    highlight: '#ffffff',
    band: '#0f1f3a',
    flameOuter: '#ff8a3d',
    flameInner: '#ffd28a',
    flameCore: '#fff6d8',
  };
  return `
    <g class="bg-rocket" opacity="0.32"
       transform="translate(${cx},${cy}) rotate(${rotate}) scale(${scale})">
      <!-- left fin -->
      <path d="M -30 38 L -54 72 Q -50 76 -30 72 Z"
            fill="${C.fin}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- right fin -->
      <path d="M 30 38 L 54 72 Q 50 76 30 72 Z"
            fill="${C.fin}" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
      <!-- body capsule: white with thin outline -->
      <path d="M -30 -50
               C -30 -68 -16 -100 0 -100
               C 16 -100 30 -68 30 -50
               L 30 64
               Q 30 70 24 70
               L -24 70
               Q -30 70 -30 64 Z"
            fill="${C.body}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>
      <!-- red nose cap -->
      <path d="M -23 -55
               C -23 -70 -12 -100 0 -100
               C 12 -100 23 -70 23 -55
               Q 12 -60 0 -60
               Q -12 -60 -23 -55 Z"
            fill="${C.nose}"/>
      <!-- nose seam -->
      <path d="M -23 -55 Q 0 -50 23 -55"
            fill="none" stroke="${C.line}" stroke-width="1.5" stroke-linecap="round"/>
      <!-- mid-body separator -->
      <line x1="-30" y1="-50" x2="30" y2="-50" stroke="${C.line}" stroke-width="1.6"/>
      <!-- porthole window -->
      <circle cx="0" cy="-15" r="20" fill="${C.windowOuter}"/>
      <circle cx="0" cy="-15" r="15" fill="${C.windowGlass}"/>
      <ellipse cx="-6" cy="-22" rx="5.5" ry="3.5" fill="${C.highlight}" opacity="0.85"/>
      <!-- lower band detail -->
      <rect x="-30" y="50" width="60" height="4" fill="${C.band}" opacity="0.55"/>
      <!-- flame: outer orange -->
      <path d="M -20 70
               Q -22 86 -12 92
               Q -8 102 0 95
               Q 8 102 12 92
               Q 22 86 20 70 Z"
            fill="${C.flameOuter}"/>
      <!-- flame: middle yellow -->
      <path d="M -12 70
               Q -13 84 -6 88
               Q -3 95 0 90
               Q 3 95 6 88
               Q 13 84 12 70 Z"
            fill="${C.flameInner}"/>
      <!-- flame: core highlight -->
      <path d="M -5 70 Q -6 80 -2 84 Q 0 88 2 84 Q 6 80 5 70 Z"
            fill="${C.flameCore}" opacity="0.85"/>
    </g>`;
}

/* ----------------------------------- tags ---------------------------------- */

function layoutTags(tags, maxWidth) {
  const list = [];
  if (!tags || !tags.length) return list;

  // Hard upper bound on visible tags, even if more fit by width. Some
  // packages (Bioconductor scater is a typical case) carry 15+ topics; we
  // simply truncate to the first N — no "+N more" pill, since it doesn't
  // tell the reader anything actionable.
  const MAX_VISIBLE = 5;

  let used = 0;
  const padX = 16, fontSize = 18;
  for (let i = 0; i < tags.length && i < MAX_VISIBLE; i++) {
    const t = tags[i];
    const w = Math.ceil(measureText('#' + t, fontSize, 500)) + padX * 2;
    const h = 36;
    if (used + w > maxWidth) break;
    list.push({ text: '#' + t, w, h });
    used += w + 10;
  }
  return list;
}

function pill(x, y, w, h, text) {
  const fontSize = 18;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" fill="${COLORS.badgeBg}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 6}" text-anchor="middle" font-weight="500" font-size="${fontSize}" fill="${COLORS.badgeInk}">${escapeXml(text)}</text>
  `;
}

function pillSubtle(x, y, w, h, text) {
  const fontSize = 18;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" fill="none" stroke="${COLORS.badgeMuted}" stroke-width="1.5"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 6}" text-anchor="middle" font-weight="600" font-size="${fontSize}" fill="${COLORS.badgeMuted}">${escapeXml(text)}</text>
  `;
}

/* ---------------------------------- footer ---------------------------------- */

// Shared footer geometry. The anchor sits closer to the bottom edge than
// before (was H - 48); icons span y - iconSize/2 .. y + iconSize/2 and the
// text baseline lands at y + 7 — designed so the icon visual centre and
// the text x-height line up.
const FOOTER_Y = H - 36;
const FOOTER_FONT_SIZE = 20;
const FOOTER_ICON_SIZE = 20;
const FOOTER_TOP = H - 72;     // y of the rule line above the footer row

function footerStats(card) {
  // Right-aligned, single row of icon + number pairs. We render right-to-left
  // so things stay aligned to the right edge.
  const items = [];
  if (card.version) items.push({ kind: 'version', value: 'v' + card.version });
  // The r-universe API caps contributor counts at 100, so anything 99+ is
  // displayed as "100+" to avoid implying a precise number.
  if (card.contributors) {
    items.push({
      kind: 'contributors',
      value: card.contributors >= 99 ? '100+' : formatNumber(card.contributors),
    });
  }
  if (card.vignettes) items.push({ kind: 'vignettes', value: String(card.vignettes) });
  if (card.downloads) items.push({ kind: 'downloads', value: formatNumber(card.downloads) });
  if (card.stars) items.push({ kind: 'stars', value: formatNumber(card.stars) });
  if (!items.length) return '';

  const y = FOOTER_Y;
  const fontSize = FOOTER_FONT_SIZE;
  const iconSize = FOOTER_ICON_SIZE;
  const gapInside = 9;     // icon -> number
  const gapBetween = 24;   // pair -> next pair
  let cursor = W - 64;
  const pieces = [];
  // Render right-to-left.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const numW = Math.ceil(measureText(it.value, fontSize, 600));
    cursor -= numW;
    pieces.push(`<text x="${cursor}" y="${y + 7}" font-weight="600" font-size="${fontSize}" fill="${COLORS.ink}">${escapeXml(it.value)}</text>`);
    cursor -= gapInside;
    cursor -= iconSize;
    pieces.push(statIcon(it.kind, cursor, y - iconSize / 2, iconSize));
    cursor -= gapBetween;
  }
  return `<g class="stats">${pieces.join('')}</g>`;
}

function statIcon(kind, x, y, size = 18, color = COLORS.accent) {
  const c = color;
  // The icon paths are designed in an 18×18 box; scale into whatever size
  // the caller asked for.
  const s = size / 18;
  const transform = `translate(${x},${y}) scale(${s})`;
  switch (kind) {
    case 'stars':
      // 5-point star
      return `<path transform="${transform}" fill="${c}" d="M9 0 L11.2 6.4 L18 6.6 L12.6 10.6 L14.6 17 L9 13.2 L3.4 17 L5.4 10.6 L0 6.6 L6.8 6.4 Z"/>`;
    case 'downloads':
      // arrow into tray
      return `<g transform="${transform}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1 V 11"/><path d="M4 7 L 9 12 L 14 7"/><path d="M2 16 H 16"/></g>`;
    case 'vignettes':
      // document
      return `<g transform="${transform}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1 H 12 L 16 5 V 17 H 3 Z"/><path d="M12 1 V 5 H 16"/><path d="M6 9 H 13"/><path d="M6 13 H 11"/></g>`;
    case 'contributors':
      // people
      return `<g transform="${transform}" fill="${c}"><circle cx="6" cy="5" r="3"/><circle cx="13" cy="6" r="2.4"/><path d="M0.5 16 C 1 12 4 11 6 11 C 8 11 11 12 11.5 16 Z"/><path d="M10.5 16 C 10.8 13 12.5 12.5 13 12.5 C 13.5 12.5 15.2 13 17.5 16 Z"/></g>`;
    case 'version':
      // tag
      return `<g transform="${transform}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 9 L 9 1 H 16 V 8 L 8 16 Z"/><circle cx="12.5" cy="4.5" r="1.2" fill="${c}"/></g>`;
    case 'globe':
      // globe / website
      return `<g transform="${transform}" stroke="${c}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="8"/><ellipse cx="9" cy="9" rx="3.6" ry="8"/><line x1="1" y1="9" x2="17" y2="9"/></g>`;
    case 'packages':
      // stacked boxes
      return `<g transform="${transform}" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6 L 9 2 L 16 6 L 9 10 Z"/><path d="M2 6 V 13 L 9 17"/><path d="M16 6 V 13 L 9 17"/><path d="M9 10 V 17"/></g>`;
    case 'articles':
      // book / article (alias of vignettes — different name, same shape)
      return `<g transform="${transform}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1 H 12 L 16 5 V 17 H 3 Z"/><path d="M12 1 V 5 H 16"/><path d="M6 9 H 13"/><path d="M6 13 H 11"/></g>`;
    case 'datasets':
      // database cylinder
      return `<g transform="${transform}" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="9" cy="3.2" rx="6.5" ry="2.2"/><path d="M2.5 3.2 V 9 a 6.5 2.2 0 0 0 13 0 V 3.2"/><path d="M2.5 9 V 14.8 a 6.5 2.2 0 0 0 13 0 V 9"/></g>`;
    case 'maintainers':
      // single-person silhouette
      return `<g transform="${transform}" fill="${c}"><circle cx="9" cy="6" r="3.2"/><path d="M2 17 C 2.5 12 5.5 11 9 11 C 12.5 11 15.5 12 16 17 Z"/></g>`;
    case 'organizations':
      // office building: outline, two rows of windows, a small door
      return `<g transform="${transform}" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="14" height="15"/><path d="M5 6 H7 M11 6 H13 M5 10 H7 M11 10 H13"/><path d="M8 17 V 13 H 10 V 17"/></g>`;
    default:
      return '';
  }
}

/* ------------------------------ utilities ------------------------------ */

function fitSingleLine(text, maxWidth, startSize, minSize, weight) {
  let size = startSize;
  while (size > minSize && measureText(text, size, weight) > maxWidth) size -= 2;
  return size;
}

function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

