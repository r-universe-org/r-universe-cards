import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCardData,
  generateSvg,
  renderSvg,
  svgToPng,
} from '../src/index.js';

// Minimal fixtures that mirror the shape of /api/packages/{pkg} responses.
// We don't fetch the real API in unit tests so they stay fast and offline.

const fxOrg = {
  Package: 'sf',
  Title: 'Simple Features for R',
  Version: '1.1-1',
  _user: 'r-spatial',
  _userbio: { type: 'organization', name: 'r-spatial', uuid: 25086656 },
  _pkglogo: 'https://example.invalid/sf-logo.png',
  _topics: ['gdal', 'geos', 'proj', 'spatial', 'cpp'],
  _maintainer: { name: 'Edzer Pebesma', login: 'edzer' },
  _stars: 1431,
  _contributors: Array.from({ length: 99 }, (_, i) => ({ user: `c${i}` })),
  _vignettes: new Array(7),
  _downloads: { count: 419594 },
};

const fxUser = {
  Package: 'curl',
  Title: 'A Modern and Flexible Web Client for R',
  Version: '7.1.0',
  _user: 'jeroen',
  _userbio: { type: 'user', uuid: 216319 },
  _pkglogo: null,
  _topics: ['curl'],
  _maintainer: { name: 'Jeroen Ooms', login: 'jeroen' },
};

const fxManyTags = {
  Package: 'scater',
  Title: 'Single-Cell Analysis Toolkit for Gene Expression Data in R',
  _user: 'bioc',
  _userbio: { type: 'organization', name: 'Bioconductor', uuid: 2286807 },
  _topics: [
    'immunooncology', 'singlecell', 'rnaseq', 'qualitycontrol',
    'preprocessing', 'normalization', 'visualization', 'dimensionreduction',
    'transcriptomics', 'geneexpression', 'sequencing', 'software',
    'dataimport', 'datarepresentation', 'infrastructure', 'coverage',
  ],
  _maintainer: { name: 'Alan OCallaghan' },
};

test('extractCardData picks the right fields out of an org-owned package', () => {
  const card = extractCardData(fxOrg);
  assert.equal(card.package, 'sf');
  assert.equal(card.title, 'Simple Features for R');
  assert.equal(card.version, '1.1-1');
  assert.deepEqual(card.tags, ['gdal', 'geos', 'proj', 'spatial', 'cpp']);
  assert.equal(card.maintainer.name, 'Edzer Pebesma');
  assert.equal(card.ownerIsOrg, true);
  assert.equal(card.ownerLogin, 'r-spatial');
  assert.equal(card.ownerUuid, 25086656);
  assert.equal(typeof card.stars, 'number');
  assert.ok(card.contributors > 0);
});

test('extractCardData flags user-owned universes via ownerIsOrg=false', () => {
  const card = extractCardData(fxUser);
  assert.equal(card.ownerIsOrg, false);
  assert.equal(card.ownerLogin, 'jeroen');
  assert.equal(card.ownerUuid, 216319);
});

test('extractCardData handles many-tagged packages', () => {
  const card = extractCardData(fxManyTags);
  assert.ok(card.tags.length >= 10);
  assert.ok(card.tags.every((t) => typeof t === 'string'));
});

test('extractCardData throws on a non-object', () => {
  assert.throws(() => extractCardData(null), TypeError);
  assert.throws(() => extractCardData('not an object'), TypeError);
});

test('renderSvg returns a self-contained SVG without a logo', () => {
  const card = extractCardData(fxOrg);
  const svg = renderSvg(card, null);
  assert.ok(svg.startsWith('<?xml'), 'should start with the XML decl');
  assert.match(svg, /<svg\b/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.match(svg, /sf<\/text>/, 'package name should appear');
  assert.match(svg, /Simple Features for R<\/text>/, 'title should appear');
  // Inter is referenced via a Google Fonts @import so any browser pulls
  // the right files — without bloating the SVG with base64 woff2.
  assert.match(svg, /@import\s+url\([^)]*fonts\.googleapis\.com[^)]*Inter/);
});

test('generateSvg works offline when fetchLogo is false', () =>
  generateSvg(fxOrg, { fetchLogo: false }).then((svg) => {
    assert.ok(svg.length > 1000);
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<\/svg>\s*$/);
  }));

test('svgToPng produces a PNG buffer from a known-good SVG', () =>
  generateSvg(fxOrg, { fetchLogo: false }).then((svg) => {
    const png = svgToPng(svg);
    assert.ok(Buffer.isBuffer(png));
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    assert.equal(png[2], 0x4e);
    assert.equal(png[3], 0x47);
    assert.ok(png.length > 5000, 'PNG should have non-trivial size');
  }));

test('svgToPng honours the scale option', () =>
  generateSvg(fxOrg, { fetchLogo: false }).then((svg) => {
    const small = svgToPng(svg);                // default scale 1
    const big = svgToPng(svg, { scale: 2 });    // 2x

    // PNG width is encoded at offset 16 (uint32 big-endian); height at 20.
    assert.equal(small.readUInt32BE(16), 1200);
    assert.equal(small.readUInt32BE(20), 630);
    assert.equal(big.readUInt32BE(16), 2400);
    assert.equal(big.readUInt32BE(20), 1260);
  }));
