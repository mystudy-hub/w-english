// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { scopeCorePrecache } from '../scripts/lib/precache.ts';

const headers = await readFile('public/_headers', 'utf8');
const rules = headers.trim().split(/\r?\n\s*\r?\n/).map((section) => {
  const [pattern, ...values] = section.split(/\r?\n/);
  const expression = pattern!.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return { matches: new RegExp(`^${expression}$`), cache: values.find((value) => value.trim().startsWith('Cache-Control:'))?.trim().slice('Cache-Control:'.length).trim() };
});
const policies = (path: string) => rules.filter((rule) => rule.matches.test(path) && rule.cache).map((rule) => rule.cache!);

it('revalidates every mutable index without also attaching an immutable cache policy', () => {
  for (const path of ['/', '/index.html', '/manifest.webmanifest', '/core/index.json', '/content/index.json', '/sw.js']) expect(policies(path), path).toEqual(['no-cache']);
});
it('keeps versioned core media immutable with one unambiguous policy', async () => {
  const core = JSON.parse(await readFile('public/core/index.json', 'utf8')) as { assets: Record<string, { url: string }> };
  const paths = [...Object.values(core.assets).map((asset) => `/${asset.url}`), '/core/guide.0123456789abcdef.mp3', '/core/ui_guide.0123456789abcdef.mp3', '/core/ui_guide-sprite.0123456789abcdef.json'];
  for (const path of paths) expect(policies(path), path).toEqual(['public, max-age=31536000, immutable']);
});
it.each(['/', '/w-english/'])('precaches only current core files without deleting old client assets: %s', (base) => {
  const current = 'core/guide.current.mp3'; const old = 'core/guide.previous.mp3';
  const entries = ['index.html', 'assets/app.js', 'core/index.json', current, old].map((url) => ({ url: `${base}${url}`, revision: 'unchanged' }));
  const result = scopeCorePrecache(entries, [current], base);
  expect(result).toEqual(entries.slice(0, -1)); expect(entries).toHaveLength(5);
  expect(scopeCorePrecache([{ url: current }, { url: old }], [current], base)).toEqual([{ url: current }]);
});
