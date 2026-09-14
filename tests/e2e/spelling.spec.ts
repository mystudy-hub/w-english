import { expect, test, type Page } from '@playwright/test';
import type { AttemptRecord, SessionSnapshot, WordProgress } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';

async function records<T>(page: Page, name: string): Promise<T[]> {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open('w-english'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), name);
}
async function active(page: Page) { return (await records<SessionSnapshot>(page, 'sessions')).find((entry) => entry.status === 'active')!; }
async function enter(page: Page, origin: string, drag = false) {
  await page.goto(origin); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  if (drag) { await page.getByRole('button', { name: /自己来探索/ }).click(); await page.getByRole('button', { name: /L3.*进阶/ }).click(); }
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
}
async function dragTile(page: Page, tile: number, slot: number | null) {
  const start = (await page.locator(`[data-letter-tile="${tile}"]`).boundingBox())!;
  const end = slot === null ? { x: 5, y: 5 } : await page.locator(`[data-spelling-slot="${slot}"]`).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  if (slot === null) await page.mouse.move(5, 5, { steps: 10 });
  else { const box = end as { x: number; y: number; width: number; height: number }; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 }); }
  await page.mouse.up();
}

test('phonics blends real playback events, and tap spelling resumes the same word and grants one participation star', async ({ page }) => {
  const server = await fixtureServer(syntheticContent({ scenes: true }));
  try {
    await page.setViewportSize({ width: 960, height: 600 });
    await enter(page, server.origin);
    await page.getByRole('button', { name: '认识猫', exact: true }).click();
    await page.getByRole('button', { name: '拼读泡泡', exact: true }).click();
    await page.getByRole('button', { name: '连起来听单词', exact: true }).click();
    await expect.poll(async () => (await records<WordProgress>(page, 'wordProgress')).find((entry) => entry.wordId === 'w_cat_001')?.heardCount ?? 0).toBe(1);
    await page.screenshot({ path: 'artifacts/screenshots/phonics.png', fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
    await page.getByRole('button', { name: '拼这个单词', exact: true }).click();
    await expect(page.locator('[data-letter-tile="0"]')).toBeEnabled();
    const before = await active(page); expect(before.activity).toBe('tapSpell'); expect(before.questions).toHaveLength(1);
    await page.locator('[data-letter-tile="0"]').click();
    await expect(page.locator('[data-letter-tile="1"]')).toBeEnabled();
    await page.reload(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.locator('[data-letter-tile="1"]')).toBeEnabled();
    const restored = await active(page);
    expect(restored.id).toBe(before.id); expect(restored.questions[0]!.spelling!.placed).toEqual([0]);
    expect(restored.questions[0]!.spelling!.tiles).toEqual(before.questions[0]!.spelling!.tiles);
    expect(await records(page, 'rewards')).toEqual([]);
    await page.screenshot({ path: 'artifacts/screenshots/spelling.png', fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
    for (const tile of [1, 2]) { await expect(page.locator(`[data-letter-tile="${tile}"]`)).toBeEnabled(); await page.locator(`[data-letter-tile="${tile}"]`).click(); }
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
    await expect(page.locator('.end-stars .earned')).toHaveCount(1); await expect(page.locator('.end-stars > svg')).toHaveCount(1);
    const attempts = await records<AttemptRecord>(page, 'attempts'); expect(attempts).toHaveLength(1); expect(attempts[0]!.activity).toBe('tapSpell');
    expect((await records<WordProgress>(page, 'wordProgress')).find((entry) => entry.wordId === 'w_cat_001')?.firstCorrectAt).toBeUndefined();
  } finally { await page.close(); await server.close(); }
});

test('drag spelling ignores outside drops and keeps a click alternative without an L3 answer timer', async ({ page }) => {
  const server = await fixtureServer(syntheticContent({ scenes: true }));
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enter(page, server.origin, true);
    await page.getByRole('button', { name: '认识猫', exact: true }).click(); await page.getByRole('button', { name: '拼这个单词', exact: true }).click();
    await expect(page.locator('[data-letter-tile="0"]')).toBeEnabled();
    const round = await active(page); expect(round.configSnapshot.learningLevel).toBe('L3'); expect(round.configSnapshot.timeLimitMs).toBeNull();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await dragTile(page, 0, null); expect((await active(page)).questions[0]!.spelling!.placed).toEqual([]);
    await dragTile(page, 0, 0); await expect(page.locator('[data-letter-tile="1"]')).toBeEnabled();
    expect((await active(page)).questions[0]!.spelling!.placed).toEqual([0]);
    await page.locator('[data-letter-tile="1"]').click(); await expect(page.locator('[data-letter-tile="2"]')).toBeEnabled();
    await dragTile(page, 2, 2);
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
    await expect(page.locator('.end-stars .earned')).toHaveCount(1);
    expect(await records(page, 'rewards')).toHaveLength(1);
  } finally { await page.close(); await server.close(); }
});

test('a five-word spelling round can reveal and skip answers across reload without awarding stars', async ({ page }) => {
  const server = await fixtureServer(syntheticContent({ scenes: true }));
  try {
    await enter(page, server.origin); await page.getByRole('button', { name: '拼字母', exact: true }).click();
    await expect(page.locator('.letter-tile').first()).toBeEnabled();
    const first = await active(page); expect(first.questions).toHaveLength(5);
    expect(new Set(first.questions.map((question) => question.wordId)).size).toBe(5);
    for (let index = 0; index < 5; index++) {
      await expect(page.locator('.letter-tile').first()).toBeEnabled();
      await page.getByRole('button', { name: '看看完整单词', exact: true }).click();
      await expect(page.locator('.letter-slot.revealed')).toHaveCount(3);
      if (index === 0) {
        await page.reload(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
        await expect(page.getByRole('button', { name: '认识下一位', exact: true })).toBeEnabled();
        expect((await active(page)).questions[0]!.spelling!.skipped).toBe(true);
      }
      await page.getByRole('button', { name: '认识下一位', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
    await expect(page.locator('.end-stars .earned')).toHaveCount(0);
    expect(await records(page, 'rewards')).toEqual([]); expect(await records(page, 'attempts')).toEqual([]);
  } finally { await page.close(); await server.close(); }
});
