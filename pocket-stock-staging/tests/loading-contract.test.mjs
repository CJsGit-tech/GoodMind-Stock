import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/loading.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/loading.css', import.meta.url), 'utf8');
const exports = {};
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length || 0, 0);
vm.runInNewContext(compiled.outputText, { exports, require });
const { LoadingSkeleton, PendingIndicator, ShimmerImage } = exports;

test('all skeleton variants announce one honest loading status and contain no fake controls', () => {
  for (const kind of ['catalog', 'article', 'preview', 'list', 'comments', 'form']) {
    const html = renderToStaticMarkup(React.createElement(LoadingSkeleton, { kind, label: '正在載入研究…' }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-label="正在載入研究…"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /loading-block/);
    assert.doesNotMatch(html, /<(?:button|input|select|textarea|a)(?:\s|>)/);
    assert.doesNotMatch(html, /(?:NaN|Infinity|aria-valuenow)/);
  }
});

test('catalog and article preserve media, text, tabs and metric geometry', () => {
  const catalog = renderToStaticMarkup(React.createElement(LoadingSkeleton, { kind: 'catalog', label: '載入' }));
  assert.equal((catalog.match(/article-card--landscape/g) || []).length, 4);
  const article = renderToStaticMarkup(React.createElement(LoadingSkeleton, { kind: 'article', label: '載入' }));
  for (const shape of ['loading-article-cover', 'loading-headline', 'loading-tabs', 'loading-metrics', 'loading-paragraphs']) {
    assert.ok(article.includes(shape));
  }
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 240px/);
});

test('pending operations retain readable real status without inventing progress', () => {
  const html = renderToStaticMarkup(React.createElement(PendingIndicator, null, '已處理 2／5 頁，等待確認'));
  assert.match(html, /已處理 2／5 頁，等待確認/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /loading-pending-bar/);
  assert.doesNotMatch(html, /aria-valuenow|role="progressbar"/);
});

test('media reserves aspect ratio and exposes alt while the image is pending', () => {
  const html = renderToStaticMarkup(React.createElement(ShimmerImage, { src: '/cover.jpg', width: 480, height: 360, alt: '研究封面' }));
  assert.match(html, /aspect-ratio:480 \/ 360/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /loading-image-placeholder/);
  assert.match(html, /alt="研究封面"/);
  assert.match(source, /image.current\?\.complete && image.current.naturalWidth > 0/);
  assert.match(source, /onLoad\?\.\(event\)/);
  assert.match(source, /onError\?\.\(event\)/);
});

test('one shimmer keyframe drives motion with reduced-motion and forced-colors exits', () => {
  assert.equal((css.match(/@keyframes/g) || []).length, 1);
  assert.match(css, /@keyframes pocketstocks-shimmer/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /rotate\(|@keyframes (?:spin|pulse)/);
});
