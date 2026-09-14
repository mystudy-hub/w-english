import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('an older app refuses a newer database and exports it without changing its schema', async ({ page }) => {
  await page.route('**/storage-seed', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Private storage fixture</title>' }));
  await page.goto('/storage-seed');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('w-english', 50); request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { request.result.createObjectStore('futureProgress', { keyPath: 'id' }).put({ id: 'kept', count: 7 }); };
    request.onsuccess = () => { request.result.close(); resolve(); };
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '临时体验', exact: true })).toBeVisible();
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(3200); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '先保留好本机学习记录' })).toBeVisible();
  await expect(page.getByText(/本机记录来自更新的应用版本/)).toBeVisible();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出本机备份', exact: true }).click();
  const file = await pending; const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(data.databaseVersion).toBe(50); expect(data.tables).toEqual({ futureProgress: [{ id: 'kept', count: 7 }] });
  const after = await page.evaluate(() => new Promise<{ version: number; stores: string[] }>((resolve) => {
    const request = indexedDB.open('w-english');
    request.onsuccess = () => { const db = request.result; const value = { version: db.version, stores: Array.from(db.objectStoreNames) }; db.close(); resolve(value); };
  }));
  expect(after).toEqual({ version: 50, stores: ['futureProgress'] });
});
