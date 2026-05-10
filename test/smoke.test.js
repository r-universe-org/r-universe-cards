import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePackageSvg,
  generateUniverseSvg,
  svgToPng,
} from '../src/index.js';
import {extractCardData} from '../src/extract.js'
import {getUniverseData} from '../src/util.js'

// All tests hit the live r-universe API. We use small / well-known endpoints
// (sf, ggplot2, the rOpenSci universe summary) so the responses are stable.




test('extractCardData', () =>
  fetch('https://r-spatial.r-universe.dev/api/packages/sf')
    .then((res) => res.json())
    .then((data) => {
      const card = extractCardData(data);
      assert.equal(card.package, 'sf');
      assert.equal(card.title, 'Simple Features for R');
      assert.equal(card.ownerLogin, 'r-spatial');
      assert.equal(card.ownerIsOrg, true);
      assert.ok(card.tags.length >= 1);
      assert.ok(card.maintainer && card.maintainer.name);
      assert.ok(card.contributors > 0);
    }));

test('extractCardData throws on a non-object', () => {
  assert.throws(() => extractCardData(null), TypeError);
  assert.throws(() => extractCardData('nope'), TypeError);
});

test('generatePackageSvg returns a complete SVG', () =>
  fetch('https://r-spatial.r-universe.dev/api/packages/sf')
    .then((res) => res.json())
    .then((data) => generatePackageSvg(data))
    .then((svg) => {
      assert.ok(svg.startsWith('<?xml'));
      assert.match(svg, /<svg\b/);
      assert.match(svg, /<\/svg>\s*$/);
      assert.match(svg, /sf<\/text>/, 'package name should appear');
      assert.match(svg, /@import\s+url\([^)]*fonts\.googleapis\.com[^)]*Inter/);
    }));

test('package SVG → svgToPng yields a 1200×630 PNG buffer', () =>
  fetch('https://r-spatial.r-universe.dev/api/packages/sf')
    .then((res) => res.json())
    .then((data) => generatePackageSvg(data))
    .then((svg) => assertPng1200x630(svgToPng(svg))));

test('generateUniverseSvg pulls summary + topics live', () =>
  getUniverseData('ropensci').then((data) => generateUniverseSvg(data)).then((svg) => {
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<\/svg>\s*$/);
    assert.match(svg, /rOpenSci<\/text>/, 'display name should appear');
    assert.match(svg, /Tools and R Packages for Open Science/, 'description should appear');
    assert.match(svg, /https:\/\/ropensci\.r-universe\.dev/);
  }));

test('universe SVG → svgToPng yields a 1200×630 PNG buffer', () =>
  getUniverseData('ropensci').then((data) => generateUniverseSvg(data)).then((svg) => assertPng1200x630(svgToPng(svg))));

function assertPng1200x630(png) {
  assert.ok(Buffer.isBuffer(png), 'should return a Buffer');
  // PNG magic bytes.
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.equal(png[2], 0x4e);
  assert.equal(png[3], 0x47);
  // PNG IHDR width @ byte 16, height @ byte 20 (both uint32 BE).
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
}
