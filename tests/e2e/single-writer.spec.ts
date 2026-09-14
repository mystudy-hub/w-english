import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { SessionSnapshot, WordProgress } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';

test.use({ serviceWorkers: 'block' });
async function install(context: BrowserContext) {
  const fixture = syntheticContent();
  await context.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
}
async function enter(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await expect(page.getByRole('heading', { name: '动物之家' })).toBeVisible();
}
async function table<T>(page: Page, name: string): Promise<T[]> {
  return page.evaluate((store) => new Promise((resolve, reject) => {
    const opened = indexedDB.open('w-english'); opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result; const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), name);
}
async function parent(page: Page) {
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(3200); await page.mouse.up();
}
async function blocked(page: Page) {
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('另一个窗口正在学习。请先回到那个窗口的欢迎页，再在这里开始。')).toBeVisible();
  await expect(page.getByRole('heading', { name: /每一个新词/ })).toBeVisible();
}

test('card visits and parent settings share one writer; handover reloads the saved settings', async ({ page, context }) => {
  await install(context); await enter(page);
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await expect.poll(async () => (await table<WordProgress>(page, 'wordProgress')).length).toBe(1);
  const second = await context.newPage(); await second.goto('/'); await blocked(second);
  await parent(second);
  await expect(second.getByRole('heading', { name: /每一个新词/ })).toBeVisible();
  await parent(page);
  await page.getByRole('combobox', { name: '操作方式', exact: true }).selectOption('drag');
  await page.getByRole('combobox', { name: '学习等级', exact: true }).selectOption('L3');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已保存。进行中的题组会保持原来的难度。')).toBeVisible();
  await page.locator('a.brand').click();
  await second.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(second.getByRole('heading', { name: '动物之家' })).toBeVisible();
  await expect(second.locator('.app')).toHaveClass(/mode-drag/);
  await expect(second.locator('.discovery-count strong')).toHaveText('1');
  await second.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(second.locator('.answer-card').first()).toBeEnabled();
  await expect(second.locator('.answer-card')).toHaveCount(4);
  await expect(second.getByRole('progressbar', { name: '剩余作答时间' })).toBeVisible();
  await blocked(page);
});

test('transferring an unfinished round preserves the exact questions and completed answers', async ({ page, context }) => {
  await install(context); await enter(page);
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  const initial = (await table<SessionSnapshot>(page, 'sessions'))[0]!;
  await page.locator(`.answer-card[data-word-id="${initial.questions[0]!.wordId}"]`).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  const second = await context.newPage(); await second.goto('/'); await blocked(second);
  await page.locator('a.brand').click();
  await second.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(second.locator('.answer-card').first()).toBeEnabled();
  const resumed = (await table<SessionSnapshot>(second, 'sessions'))[0]!;
  expect(resumed.id).toBe(initial.id); expect(resumed.manifestId).toBe(initial.manifestId);
  expect(resumed.currentQuestionIndex).toBe(1);
  expect(resumed.questions.map((question) => question.optionIds)).toEqual(initial.questions.map((question) => question.optionIds));
  expect((await table(second, 'attempts')).length).toBe(1);
  expect((await table(second, 'rewards')).length).toBe(1);
});

test('round completion keeps ownership until the child returns to welcome', async ({ page, context }) => {
  await install(context); await enter(page);
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const round = (await table<SessionSnapshot>(page, 'sessions'))[0]!;
    await page.locator(`.answer-card[data-word-id="${round.questions[index]!.wordId}"]`).click();
  }
  await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
  const second = await context.newPage(); await second.goto('/'); await blocked(second);
  await page.close();
  await second.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(second.getByRole('heading', { name: '动物之家' })).toBeVisible();
  expect((await table(second, 'rewards')).length).toBe(5);
});

test('a browser without Web Locks offers card playback without writing learning progress', async ({ page, context }) => {
  await install(context);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); });
  await enter(page);
  await expect(page.getByText('当前浏览器仅支持卡片体验，本次学习记录和设置不会保存。')).toBeVisible();
  await expect(page.getByRole('button', { name: '听音选图', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await page.getByRole('button', { name: '听单词', exact: true }).click();
  await expect(page.getByRole('button', { name: '听单词', exact: true })).toBeEnabled();
  expect(await table(page, 'wordProgress')).toEqual([]);
  expect(await table(page, 'sessions')).toEqual([]);
  expect((await table<{ onboardingComplete: boolean }>(page, 'settings'))[0]!.onboardingComplete).toBe(false);
});
