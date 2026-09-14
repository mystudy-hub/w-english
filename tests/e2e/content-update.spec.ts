import { expect, test, type Page } from '@playwright/test';
import type { ContentPackRecord, SessionSnapshot, WordProgress } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';
import { localRecords } from '../helpers/local-records.ts';

async function enter(page: Page, origin: string) {
  await page.goto(origin); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
}
async function currentRound(page: Page) { return (await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.status === 'active')!; }
async function answer(page: Page) {
  await expect(page.locator('.answer-card').first()).toBeEnabled(); const round = await currentRound(page);
  await page.locator(`.answer-card[data-word-id="${round.questions[round.currentQuestionIndex]!.wordId}"]`).click();
}
async function parent(page: Page) {
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(3200); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '陪伴每一个小发现' })).toBeVisible();
}

test('an unfinished round stays on its exact manifest, the next round upgrades, and corruption recovers offline', async ({ page, context }) => {
  test.setTimeout(45_000);
  const first = syntheticContent({ scenes: true });
  const server = await fixtureServer(first);
  try {
    await enter(page, server.origin); await answer(page);
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const original = await currentRound(page); const retiredId = original.questions[original.currentQuestionIndex]!.wordId;
    const next = syntheticContent({ scenes: true, version: '2026.09.2', tone: 480, retiredWordIds: [retiredId] }); server.deploy(next);
    await page.reload(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const resumed = await currentRound(page);
    expect(resumed.manifestId).toBe(first.manifestHash); expect(resumed.currentQuestionIndex).toBe(1);
    expect(resumed.questionIds).toEqual(original.questionIds);
    expect(resumed.questions.map((question) => question.optionIds)).toEqual(original.questions.map((question) => question.optionIds));
    expect(server.requests).not.toContain(next.manifest.assets['audio:animal_home']!.url);
    for (let index = 1; index < 5; index++) await answer(page);
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
    const progress = await localRecords<WordProgress>(page, 'wordProgress');
    await page.locator('a.brand').click(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect.poll(async () => (await localRecords<ContentPackRecord>(page, 'contentPacks')).find((pack) => pack.id === next.manifestHash)?.readyThemeIds ?? []).toContain('animal_home');
    await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
    await page.getByRole('button', { name: '听音选图', exact: true }).click();
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const upgraded = await currentRound(page);
    expect(upgraded.manifestId).toBe(next.manifestHash); expect(upgraded.contentVersion).toBe('2026.09.2');
    expect(upgraded.questions.every((question) => !question.optionIds.includes(retiredId))).toBe(true);
    const firstCorrect = (entries: WordProgress[]) => entries.filter((entry) => entry.firstCorrectAt !== undefined).map((entry) => [entry.wordId, entry.firstCorrectAt]);
    expect(firstCorrect(await localRecords<WordProgress>(page, 'wordProgress'))).toEqual(firstCorrect(progress));
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.evaluate(async (path) => { const cache = await caches.open('w-english-content-v1'); await cache.delete(new URL(path, location.href)); }, next.manifest.assets['audio:animal_home']!.url);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true); await page.reload();
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
    await page.getByRole('button', { name: '听音选图', exact: true }).click();
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    expect((await currentRound(page)).manifestId).toBe(first.manifestHash);
    expect((await localRecords<ContentPackRecord>(page, 'contentPacks')).find((pack) => pack.id === next.manifestHash)?.state).not.toBe('active');
  } finally { await context.setOffline(false); await page.close(); await server.close(); }
});

test('parents can pause a different scene and resume its verified files while the first scene stays ready', async ({ page }) => {
  const fixture = syntheticContent({ scenes: true }); const server = await fixtureServer(fixture);
  const secondAudio = fixture.manifest.assets['audio:sunny_garden']!.url; const release = server.hold(secondAudio);
  try {
    await enter(page, server.origin); for (let index = 0; index < 5; index++) await answer(page);
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible(); await parent(page);
    await page.getByRole('button', { name: '准备阳光花园', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停准备阳光花园', exact: true })).toBeVisible();
    const imagePath = fixture.manifest.assets['/images/words/cup.svg']!.url;
    await expect.poll(() => page.evaluate(async (path) => Boolean(await caches.match(new URL(path, location.href))), imagePath)).toBe(true);
    await page.getByRole('button', { name: '暂停准备阳光花园', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续准备阳光花园', exact: true })).toBeEnabled();
    const paused = (await localRecords<ContentPackRecord>(page, 'contentPacks')).find((pack) => pack.id === fixture.manifestHash)!;
    expect(paused.state).toBe('active'); expect(paused.readyThemeIds).toEqual(['animal_home']);
    const imageRequests = server.requests.filter((path) => path === imagePath).length;
    release(); await page.getByRole('button', { name: '继续准备阳光花园', exact: true }).click();
    await expect(page.getByRole('button', { name: '检查阳光花园', exact: true })).toBeEnabled();
    expect(server.requests.filter((path) => path === imagePath)).toHaveLength(imageRequests);
    expect(server.requests).not.toContain(fixture.manifest.assets['audio:happy_school']!.url);
    expect(await localRecords(page, 'attempts')).toHaveLength(5);
  } finally { release(); await page.close(); await server.close(); }
});
