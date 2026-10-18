import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReaderAccountDestination } from '../../src/reader-return-routes.ts';

test('reader reauthentication accepts owned local destinations without permitting author or external redirects', () => {
  for (const path of ['/my-library', '/my-library/favorites', '/my-library/reviews', '/reader/suggestions', '/reader/research-interest', '/active-etf', '/active-etf/history', '/active-etf/report-2026-10-13']) assert.equal(isReaderAccountDestination(path), true, path);
  for (const path of ['/admin', '/admin/reader-feedback', '/preview/book', '//untrusted.invalid', 'https://untrusted.invalid', '/my-library/other', '/active-etf/../admin', '/active-etf/a/b']) assert.equal(isReaderAccountDestination(path), false, path);
});
