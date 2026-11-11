import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarkdownReport } from '../../shared/etf-markdown';

const output = await mkdtemp(join(tmpdir(), 'pocketstocks-research-heading-'));
const entry = join(output, 'heading.mjs');
await build({ entryPoints: [resolve('src/research-article-heading.tsx')], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', loader: { '.css': 'empty' } });
await symlink(resolve('node_modules'), join(output, 'node_modules'));
const { ResearchArticleHeading } = await import(pathToFileURL(entry).href);
test.after(async () => { await rm(output, { recursive: true, force: true }); });
const report = { title: '研究文章', excerpt: '已查證的研究摘要', period: { start: '2026-10-14', end: '2026-10-15' },
  evidenceDate: '2026-10-16', frontmatter: { data_status: 'partial' } } as MarkdownReport;

test('public research heading exposes identity, dates and cover without preview flag', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchArticleHeading, { report, label: '主動式 ETF 研究',
    coverUrl: '/cover.jpg', publishedAt: '2026-10-17T11:09:29Z' }));
  assert.match(html, /<h1>研究文章<\/h1>/);
  assert.match(html, /已查證的研究摘要/);
  assert.match(html, /2026-10-14/);
  assert.match(html, /2026-10-16/);
  assert.match(html, /19:09:29/);
  assert.match(html, /alt="《研究文章》封面"/);
  assert.doesNotMatch(html, /私有預覽/);
});

test('preview retains private status and missing cover does not remove text', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchArticleHeading, { report, label: '主動式 ETF 研究', preview: true }));
  assert.match(html, /私有預覽/);
  assert.match(html, /資料部分覆蓋/);
  assert.match(html, /<h1>研究文章<\/h1>/);
  assert.doesNotMatch(html, /<img/);
});
