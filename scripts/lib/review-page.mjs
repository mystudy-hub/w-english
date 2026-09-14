import { readFile } from 'node:fs/promises';

export async function renderReviewPage(data) {
  const [template, script] = await Promise.all([
    readFile(new URL('../review/page.html', import.meta.url), 'utf8'),
    readFile(new URL('../review/review.js', import.meta.url), 'utf8'),
  ]);
  const json = JSON.stringify({ ...data, production: undefined, assets: undefined, existing: undefined, wordSource: undefined })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('__REVIEW_SCRIPT__', () => script).replace('__REVIEW_DATA__', () => json);
}
