import { expect, test, type Page } from '@playwright/test';
import type { SessionSnapshot, UsageState } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { localRecords, openParentWithClock } from '../helpers/local-records.ts';

test.use({ serviceWorkers: 'block' });

async function enter(page: Page, audio = false) {
  const fixture = syntheticContent({ scenes: true, audio });
  await page.clock.install();
  await page.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await expect(page.getByRole('heading', { name: '今天，想去哪里看看？' })).toBeVisible();
}
async function usage(page: Page) { return (await localRecords<UsageState>(page, 'activityState'))[0]!; }
async function visibility(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('foreground timing excludes parent and hidden pages; twelve minutes offers one extension', async ({ page }) => {
  await enter(page); await page.clock.fastForward(60_000);
  await openParentWithClock(page);
  await page.getByRole('combobox', { name: '休息间隔', exact: true }).selectOption('12');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(async () => (await usage(page)).limitMinutes).toBe(12);
  const parentTime = (await usage(page)).elapsedMs;
  await page.clock.fastForward(15 * 60_000);
  expect((await usage(page)).elapsedMs).toBe(parentTime);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await visibility(page, true);
  const hiddenTime = (await usage(page)).elapsedMs;
  await page.clock.fastForward(15 * 60_000);
  expect((await usage(page)).elapsedMs).toBe(hiddenTime);
  await visibility(page, false);
  await page.clock.fastForward(12 * 60_000 - hiddenTime + 1000);
  const dialog = page.getByRole('dialog', { name: '让小眼睛休息一下' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '再玩三分钟' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await usage(page)).extensionUsed).toBe(true);
  await page.clock.fastForward(178_000); await expect(dialog).not.toBeVisible();
  await page.clock.fastForward(3000); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '再玩三分钟' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '先休息一会儿' }).click();
  await dialog.getByRole('button', { name: '准备好了，继续探索' }).click();
  await expect(dialog).not.toBeVisible();
  expect((await usage(page)).cycle).toBe(1);
  expect(await localRecords(page, 'attempts')).toEqual([]);
});

test('eighteen-minute rest survives reload and preserves a fixed three-minute deadline', async ({ page }) => {
  await enter(page); await openParentWithClock(page);
  await page.getByRole('combobox', { name: '休息间隔', exact: true }).selectOption('18');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(async () => (await usage(page)).limitMinutes).toBe(18);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.clock.fastForward(18 * 60_000);
  const dialog = page.getByRole('dialog', { name: '让小眼睛休息一下' });
  const resume = dialog.getByRole('button', { name: '准备好了，继续探索' });
  await expect(dialog).toBeVisible(); await expect(resume).toBeDisabled();
  const deadline = (await usage(page)).restUntil!;
  await page.screenshot({ path: 'artifacts/screenshots/rest.png', fullPage: true });
  await page.clock.fastForward(60_000); await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(dialog).toBeVisible(); await expect(resume).toBeDisabled();
  expect((await usage(page)).restUntil).toBe(deadline);
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await openParentWithClock(page, dialog);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect((await usage(page)).restUntil).toBe(deadline);
  const left = deadline - await page.evaluate(() => Date.now());
  await page.clock.fastForward(Math.max(1, left + 1000));
  await expect(resume).toBeEnabled(); await resume.click(); await expect(dialog).not.toBeVisible();
  expect((await usage(page)).cycle).toBe(1);
  expect(await localRecords(page, 'rewards')).toEqual([]);
});

test('a due reminder lets the current answer finish and pauses before the next target plays', async ({ page }) => {
  await enter(page, true); await openParentWithClock(page);
  await page.getByRole('combobox', { name: '向导陪伴', exact: true }).selectOption('false');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('设置已保存。进行中的题组会保持原来的难度。')).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  // Only advance time after a natural audio ending; elapsed time is never listening evidence.
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  const before = (await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.status === 'active')!;
  await page.clock.fastForward(8 * 60_000);
  await expect.poll(async () => (await usage(page)).pendingQuestionId).toBe(before.questions[0]!.id);
  const dialog = page.getByRole('dialog', { name: '让小眼睛休息一下' });
  await expect(dialog).not.toBeVisible();
  await page.locator(`.answer-card[data-word-id="${before.questions[0]!.wordId}"]`).click();
  await expect(dialog).toBeVisible();
  const paused = (await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.id === before.id)!;
  expect(paused.currentQuestionIndex).toBe(1); expect(paused.questions[1]!.heardInQuestion).toBe(false);
  expect(await localRecords(page, 'attempts')).toHaveLength(1);
  await dialog.getByRole('button', { name: '继续探索', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
});
