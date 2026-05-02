import fs from 'node:fs';
import path from 'node:path';
import createError from 'http-errors';

/**
 * Fetch a remote logo and return { dataUri, isSvg, mime } or null on failure.
 * The dataUri can be embedded directly into an `<image href="..."/>` element.
 *
 * Logos on r-universe come from GitHub raw URLs and are usually PNG, sometimes
 * SVG. SVGs need different handling because resvg won't follow nested data
 * URIs for raster images inside an `<image>` tag, but it will inline-render
 * an embedded `<svg>` element.
 *
 * Returns a Promise that resolves to the descriptor (or null on any failure
 * — bad URL, non-2xx response, timeout, unrecognised content type).
 */
export function fetchLogo(url) {
  return fetch(normalize_github_url(url)).then(function(res){
    if (!res.ok) {
      return res.json().catch(e => res.text()).then(function(data){
        throw createError(res.status, `GitHub API returned HTTP ${res.status}: ${data.message || data}`);
      });
    }
    const contentType = res.headers.get('content-type') || '';
    return res.arrayBuffer().then((arr) => describe(url, contentType, Buffer.from(arr)));
  });
}

function describe(url, contentType, buffer) {
  const mime = guessMime(url, contentType, buffer);
  if (!mime) {
    throw createError(400, "Could not detect logo content type");
  }
  if (mime === 'image/svg+xml') {
    return { isSvg: true, svg: buffer.toString('utf8'), mime };
  }
  return {
    isSvg: false,
    dataUri: `data:${mime};base64,${buffer.toString('base64')}`,
    mime,
  };
}

function guessMime(url, contentType, buffer) {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return ct.split(';')[0].trim();

  const ext = path.extname(new URL(url).pathname).toLowerCase();
  const byExt = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  if (byExt[ext]) return byExt[ext];

  // Sniff by magic bytes.
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (/^\s*<\?xml|^\s*<svg/i.test(buffer.subarray(0, 256).toString('utf8'))) return 'image/svg+xml';
  return null;
}

function normalize_github_url(url){
  return url.replace(
    /https:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/(.+)/,
    'https://raw.githubusercontent.com/$1/$2'
  );
}

