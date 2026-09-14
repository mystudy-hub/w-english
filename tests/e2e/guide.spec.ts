import { expect, test, type Page } from '@playwright/test';
import type { SessionSnapshot } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { auditChildPage } from '../helpers/accessibility.ts';

test.use({ serviceWorkers: 'block' });
async function start(page: Page, mode: 'tap' | 'drag' = 'tap', level: 'L1' | 'L3' = 'L1') {
  const fixture = syntheticContent();
  await page.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  if (mode === 'drag') await page.getByRole('button', { name: /自己来探索/ }).click();
  if (level === 'L3') await page.getByRole('button', { name: /L3.*进阶/ }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
}
async function session(page: Page): Promise<SessionSnapshot> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opened = indexedDB.open('w-english'); opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result; const request = db.transaction('sessions').objectStore('sessions').getAll();
      request.onsuccess = () => { db.close(); resolve(request.result.find((value: { status: string }) => value.status === 'active')); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }));
}
async function parent(page: Page) {
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(3200); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '陪伴每一个小发现' })).toBeVisible();
}

test('intro and idle narration finish before answering, and idle budget survives reload', async ({ page }) => {
  test.setTimeout(45_000);
  await start(page);
  expect((await session(page)).guideIntroPlayed).toBe(true);
  await expect.poll(async () => (await session(page)).questions[0]?.idlePromptCount ?? 0, { timeout: 12_000 }).toBe(1);
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  const before = await session(page);
  expect(before.questions[0]?.attemptCount).toBe(0);
  expect(before.questions[0]?.hinted).toBe(false);
  await page.reload(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  expect((await session(page)).id).toBe(before.id);
  expect((await session(page)).questions[0]?.idlePromptCount).toBe(1);
  await page.waitForTimeout(8500);
  expect((await session(page)).questions[0]?.idlePromptCount).toBe(1);
});

test('drag mode keeps guide narration off while word playback still enables answers', async ({ page }) => {
  await start(page, 'drag');
  expect((await session(page)).guideIntroPlayed).toBeUndefined();
  await page.waitForTimeout(8500);
  expect((await session(page)).questions[0]?.idlePromptCount ?? 0).toBe(0);
  await expect(page.locator('.answer-card').first()).toBeEnabled();
});

test('parent edits apply to the next round without shrinking current touch targets', async ({ page }) => {
  await start(page);
  const initial = await session(page);
  await parent(page);
  await page.getByRole('combobox', { name: '操作方式', exact: true }).selectOption('drag');
  await page.getByRole('combobox', { name: '学习等级', exact: true }).selectOption('L3');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  expect((await session(page)).id).toBe(initial.id);
  await expect(page.locator('.app')).toHaveClass(/mode-tap/);
  await expect(page.locator('.answer-card')).toHaveCount(3);
  await expect(page.locator('.timer-wrap')).toHaveCount(0);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  await expect(page.locator('.app')).toHaveClass(/mode-drag/);
  await expect(page.locator('.answer-card')).toHaveCount(4);
  await expect(page.locator('.timer-wrap')).toBeVisible();
});

test('replaying L3 audio preserves the consumed answer budget', async ({ page }) => {
  await start(page, 'tap', 'L3');
  expect((await auditChildPage(page, 'tap')).issues).toEqual([]);
  await page.waitForTimeout(2200);
  const before = Number(await page.getByRole('progressbar', { name: '剩余作答时间' }).getAttribute('aria-valuenow'));
  expect(before).toBeLessThanOrEqual(13);
  await page.getByRole('button', { name: '重播题目声音' }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  const after = Number(await page.getByRole('progressbar', { name: '剩余作答时间' }).getAttribute('aria-valuenow'));
  expect(after).toBeLessThanOrEqual(before);
});
