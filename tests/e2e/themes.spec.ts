import { expect, test, type Page } from '@playwright/test';
import type { ContentPackRecord, SessionSnapshot, WordProgress } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';

async function records<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open('w-english'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), table);
}
async function start(page: Page, origin: string) {
  await page.goto(origin); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await expect(page.getByRole('heading', { name: '今天，想去哪里看看？' })).toBeVisible();
}

test('a real learning round unlocks the next scene without prefetching locked media, and both reopen offline', async ({ page, context }) => {
  const fixture = syntheticContent({ scenes: true }); const server = await fixtureServer(fixture);
  try {
    await start(page, server.origin);
    await expect(page.getByRole('button', { name: '阳光花园尚未开放' })).toBeDisabled();
    await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
    await page.getByRole('button', { name: '听音选图', exact: true }).click();
    for (let index = 0; index < 5; index++) {
      await expect(page.locator('.answer-card').first()).toBeEnabled();
      const round = (await records<SessionSnapshot>(page, 'sessions')).find((entry) => entry.status === 'active')!;
      expect(fixture.themes[0]!.wordIds).toContain(round.questions[index]!.wordId);
      await page.locator(`.answer-card[data-word-id="${round.questions[index]!.wordId}"]`).click();
    }
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
    await page.getByRole('button', { name: '贴纸图鉴', exact: true }).click();
    await expect(page.getByRole('heading', { name: '把小小发现，收进贴纸册' })).toBeVisible();
    await expect(page.locator('.sticker-tile.earned')).toHaveCount(1);
    await page.screenshot({ path: 'artifacts/screenshots/stickers.png', fullPage: true });
    await page.locator('a.brand').click(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.getByRole('button', { name: '准备阳光花园', exact: true })).toBeEnabled();
    expect(server.requests).not.toContain(fixture.manifest.assets['audio:sunny_garden']!.url);
    expect(server.requests).not.toContain(fixture.manifest.assets['/images/words/cup.svg']!.url);
    await page.screenshot({ path: 'artifacts/screenshots/themes.png', fullPage: true });
    await page.getByRole('button', { name: '准备阳光花园', exact: true }).click();
    await expect(page.getByRole('heading', { name: '阳光花园', level: 1 })).toBeVisible();
    const pack = (await records<ContentPackRecord>(page, 'contentPacks')).find((entry) => entry.id === fixture.manifestHash)!;
    expect(pack.readyThemeIds).toEqual(['animal_home', 'sunny_garden']);
    expect(pack.activeThemeId).toBe('sunny_garden');
    expect(server.requests).not.toContain(fixture.manifest.assets['audio:happy_school']!.url);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true); await page.reload();
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await page.getByRole('button', { name: '进入阳光花园', exact: true }).click();
    await page.getByRole('button', { name: '认识杯子', exact: true }).click();
    await page.getByRole('button', { name: '听单词', exact: true }).click();
    await expect.poll(async () => (await records<WordProgress>(page, 'wordProgress')).find((entry) => entry.wordId === 'w_cup_011')?.heardCount ?? 0).toBeGreaterThan(0);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '听音选图', exact: true }).click();
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const next = (await records<SessionSnapshot>(page, 'sessions')).find((entry) => entry.status === 'active')!;
    expect(next.themeId).toBe('sunny_garden');
    expect(next.questions.every((question) => question.optionIds.every((id) => fixture.themes[1]!.wordIds.includes(id)))).toBe(true);
  } finally { await context.setOffline(false); await page.close(); await server.close(); }
});

test('direct scene and word routes cannot bypass the prerequisite or create exploration evidence', async ({ page }) => {
  const fixture = syntheticContent({ scenes: true }); const server = await fixtureServer(fixture);
  try {
    await start(page, server.origin);
    await page.evaluate(() => { location.hash = '/word/w_cup_011'; });
    await expect(page.getByRole('heading', { name: '先从亮起来的地方开始吧' })).toBeVisible();
    expect(await records(page, 'wordProgress')).toEqual([]);
    await page.evaluate(() => { location.hash = '/scene/sunny_garden'; });
    await expect(page.getByRole('heading', { name: '今天，想去哪里看看？' })).toBeVisible();
    await expect(page.getByRole('button', { name: '阳光花园尚未开放' })).toBeDisabled();
    expect(server.requests).not.toContain(fixture.manifest.assets['audio:sunny_garden']!.url);
  } finally { await page.close(); await server.close(); }
});
