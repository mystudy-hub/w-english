import { expect, test, type Page } from '@playwright/test';
import type { ContentPackRecord } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { localRecords } from '../helpers/local-records.ts';

test.use({ serviceWorkers: 'block' });

async function holdSessionReads(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('w-english'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const transaction = db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions'); let holding = true; let started = false;
      let finish!: () => void; const ended = new Promise<void>((done) => { finish = done; });
      const state = window as unknown as { releaseSessionGate?: () => Promise<void> };
      state.releaseSessionGate = () => { holding = false; return ended; };
      transaction.oncomplete = () => { db.close(); finish(); };
      transaction.onabort = () => { db.close(); finish(); reject(transaction.error ?? new Error('Private session gate aborted')); };
      // Keep an exclusive transaction active without changing any records.
      const read = () => {
        const request = store.get('__private_session_start_gate__');
        request.onsuccess = () => { if (!started) { started = true; resolve(); } if (holding) read(); };
      };
      read();
    };
  }));
}
async function releaseSessionReads(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseSessionGate?: () => Promise<void> }).releaseSessionGate?.());
}

test('a cancelled start cannot use the next visit writer lock to create a hidden round', async ({ page }) => {
  const fixture = syntheticContent({ scenes: true });
  await page.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '听音选图', exact: true })).toBeEnabled();
  await expect.poll(async () => (await localRecords<ContentPackRecord>(page, 'contentPacks')).some((pack) => pack.state === 'active')).toBe(true);
  await holdSessionReads(page);
  try {
    await page.getByRole('button', { name: '听音选图', exact: true }).click();
    await expect(page.getByRole('button', { name: '听音选图', exact: true })).toBeDisabled();
    await page.locator('a.brand').click();
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.getByRole('button', { name: '正在准备小小世界…', exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.some((lock) => lock.name === 'w-english:learning-writer'))).toBe(true);
    await releaseSessionReads(page);
    await expect(page.getByRole('heading', { name: '今天，想去哪里看看？' })).toBeVisible();
    await expect(page).toHaveURL(/#\/themes$/);
    expect(await localRecords(page, 'sessions')).toEqual([]);
    expect(await localRecords(page, 'attempts')).toEqual([]);
    await expect(page.getByText('这一轮还没准备好，先认识一位朋友吧。')).toHaveCount(0);
  } finally { await releaseSessionReads(page).catch(() => {}); }
});
