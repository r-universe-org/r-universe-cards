/**
 * Escape characters that would break XML/SVG.
 */
export function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Approximate text width using a per-weight average advance width factor.
 * This is good enough for layout decisions (where to wrap, when to truncate);
 * we are not aiming for pixel-perfect kerning. Inter has fairly uniform metrics.
 */
export function measureText(text, fontSize, weight) {
  if (!text) return 0;
  // Approximate advance widths (em fraction) calibrated for Inter.
  // weight 400: ~0.52, 600: ~0.55, 700: ~0.56
  let avg;
  if (weight >= 700) avg = 0.56;
  else if (weight >= 600) avg = 0.55;
  else avg = 0.52;
  // Slight per-character correction: narrow letters (i,l,t,r,f) vs wide (m,w,M,W).
  let total = 0;
  for (const ch of text) {
    if (/[ilftj.,;:'!|]/.test(ch)) total += avg * 0.45;
    else if (/[rk]/.test(ch)) total += avg * 0.6;
    else if (/[mwMW]/.test(ch)) total += avg * 1.45;
    else if (/[A-Z0-9]/.test(ch)) total += avg * 1.1;
    else total += avg;
  }
  return total * fontSize;
}

/**
 * Truncate text with ellipsis to fit within maxWidth at the given size/weight.
 */
export function truncateToWidth(text, maxWidth, fontSize, weight) {
  if (!text) return '';
  if (measureText(text, fontSize, weight) <= maxWidth) return text;
  const ellipsis = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid).trimEnd() + ellipsis;
    if (measureText(candidate, fontSize, weight) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ellipsis;
}

/**
 * Wrap text into up to maxLines lines that fit maxWidth.
 * The final visible line is truncated with an ellipsis if more text remains.
 */
export function wrapText(text, maxWidth, fontSize, weight, maxLines) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? current + ' ' + word : word;
    if (measureText(candidate, fontSize, weight) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    // Check if anything was dropped; if so, ellipsize the last line.
    const usedChars = lines.join(' ').length;
    if (usedChars < text.replace(/\s+/g, ' ').trim().length) {
      lines[maxLines - 1] = truncateToWidth(lines[maxLines - 1] + '…', maxWidth, fontSize, weight);
    }
  }
  return lines;
}

export function getUniverseData(login){
  return Promise.all([
    fetch(`https://${login}.r-universe.dev/api/summary`).then((r) => r.json()),
    fetch(`https://${login}.r-universe.dev/api/topics?limit=5`).then((r) => r.json()),
  ]).then(([summary, topics]) => {  
    summary.topics = topics;
    return summary;
  });
}
