import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePackageSvg,
  generateUniverseSvg,
  svgToPng,
  svgToPngSubprocess,
} from '../src/index.js';
import {extractCardData} from '../src/extract.js'

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
  fetch('https://ropensci.r-universe.dev/api/summary')
    .then((res) => res.json())
    .then((data) => generateUniverseSvg(data)).then((svg) => {
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<\/svg>\s*$/);
    assert.match(svg, /rOpenSci<\/text>/, 'display name should appear');
    assert.match(svg, /Tools and R Packages for Open Science/, 'description should appear');
    assert.match(svg, /https:\/\/ropensci\.r-universe\.dev/);
  }));

test('universe SVG → svgToPng yields a 1200×630 PNG buffer', () =>
  fetch('https://ropensci.r-universe.dev/api/summary')
    .then((res) => res.json())
    .then((data) => generateUniverseSvg(data)).then((svg) => assertPng1200x630(svgToPng(svg))));

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

// Element with a filter entirely outside the canvas makes resvg panic and abort
// the process: https://github.com/thx/resvg-js/issues/423
const panicSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
  '<filter id="f"><feGaussianBlur stdDeviation="5"/></filter>' +
  '<rect x="5000" y="5000" width="10" height="10" filter="url(#f)"/></svg>';
const okSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
  '<rect width="50" height="50" fill="red"/></svg>';

test('svgToPngSubprocess renders the same png as svgToPng', () =>
  svgToPngSubprocess(okSvg).then((png) => {
    assert.ok(Buffer.isBuffer(png));
    assert.ok(png.equals(svgToPng(okSvg)));
  }));

test('svgToPngSubprocess survives a resvg panic', () =>
  Promise.all([
    svgToPngSubprocess(panicSvg, 'panic test').then(
      () => assert.fail('expected a rejection'),
      (err) => {
        assert.equal(err.status, 500);
        assert.match(err.message, /crashed while rendering panic test/);
      }),
    svgToPngSubprocess(okSvg).then((png) => assert.ok(png.equals(svgToPng(okSvg)))),
  ]));
