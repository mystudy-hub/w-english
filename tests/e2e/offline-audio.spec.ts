import { expect, test, type Page } from '@playwright/test';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';

async function enter(page: Page, origin: string) {
  await page.goto(origin); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await expect(page.getByRole('button', { name: '听音选图', exact: true })).toBeEnabled();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}
async function parent(page: Page) {
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(3200); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '陪伴每一个小发现' })).toBeVisible();
}
async function cacheHash(page: Page, path: string) {
  return page.evaluate(async (url) => {
    const cache = await caches.open('w-english-content-v1'); const response = await cache.match(url);
    if (!response) return undefined;
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }, path);
}

test('the production service worker reopens with offline sound and serves a range without replacing the full file', async ({ page, context }) => {
  const fixture = syntheticContent(); const server = await fixtureServer(fixture);
  try {
    await enter(page, server.origin); await parent(page);
    await expect(page.getByText('已就绪，可离线使用', { exact: true })).toBeVisible();
    await context.setOffline(true); await page.reload();
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await page.getByRole('button', { name: '认识猫', exact: true }).click();
    await page.getByRole('button', { name: '听单词', exact: true }).click();
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('w-english'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const get = db.transaction('wordProgress').objectStore('wordProgress').get('w_cat_001');
        get.onsuccess = () => { db.close(); resolve(get.result?.heardCount ?? 0); };
      };
    }))).toBeGreaterThan(0);
    const asset = fixture.manifest.assets['audio:animal_home']!;
    const range = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: 'bytes=44-87' } });
      return { status: response.status, length: (await response.arrayBuffer()).byteLength, range: response.headers.get('Content-Range') };
    }, `${server.origin}/${asset.url}`);
    expect(range).toEqual({ status: 206, length: 44, range: `bytes 44-87/${asset.bytes}` });
    expect(await cacheHash(page, `${server.origin}/${asset.url}`)).toBe(asset.sha256);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '听音选图', exact: true }).click();
    await expect(page.locator('.answer-card').first()).toBeEnabled();
  } finally { await context.setOffline(false); await page.close(); await server.close(); }
});

test('the downloader repairs corruption through a controlling service worker', async ({ page }) => {
  const fixture = syntheticContent(); const server = await fixtureServer(fixture);
  try {
    await enter(page, server.origin); await parent(page);
    const asset = fixture.manifest.assets['audio:animal_home']!; const url = `${server.origin}/${asset.url}`;
    const before = server.requests.filter((path) => path === asset.url).length;
    await page.evaluate(async (path) => { const cache = await caches.open('w-english-content-v1'); await cache.put(path, new Response('corrupted')); }, url);
    await page.getByRole('button', { name: '检查本地内容', exact: true }).click();
    await expect.poll(() => cacheHash(page, url)).toBe(asset.sha256);
    await expect(page.getByText('已就绪，可离线使用', { exact: true })).toBeVisible();
    expect(server.requests.filter((path) => path === asset.url).length).toBeGreaterThan(before);
  } finally { await page.close(); await server.close(); }
});
