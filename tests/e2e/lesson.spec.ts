import { expect, test } from '@playwright/test';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { auditChildPage } from '../helpers/accessibility.ts';

test.use({ serviceWorkers: 'block' });
test('synthetic audio exercises playback, retry, progress and round completion without real voice claims', async ({ page }) => {
  const fixture = syntheticContent();
  await page.route('**/content/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const file = fixture.files.get(path);
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeEnabled();
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await expect(page.locator('.answer-card').first()).toBeDisabled();
  await page.getByRole('button', { name: '打开声音', exact: true }).click();
  let firstWord = '';
  for (let index = 0; index < 5; index++) {
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const target = await page.evaluate(() => new Promise<string>((resolve, reject) => {
      const opened = indexedDB.open('w-english'); opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result; const request = db.transaction('sessions').objectStore('sessions').getAll();
        request.onsuccess = () => {
          const session = request.result.find((value: { status: string }) => value.status === 'active') as { questions: { wordId: string }[]; currentQuestionIndex: number } | undefined;
          db.close(); if (!session) reject(new Error('No active session')); else resolve(session.questions[session.currentQuestionIndex]!.wordId);
        };
        request.onerror = () => { db.close(); reject(request.error); };
      };
    }));
    if (index === 0) {
      firstWord = target;
      await page.locator(`.answer-card:not([data-word-id="${target}"])`).first().click();
      await expect(page.locator(`.answer-card[data-word-id="${target}"]`)).toBeEnabled();
    }
    if (index === 1) {
      for (let retry = 0; retry < 2; retry++) {
        await page.locator(`.answer-card:not([data-word-id="${target}"])`).first().click();
        await expect(page.locator(`.answer-card[data-word-id="${target}"]`)).toBeEnabled();
      }
      await expect(page.locator('.hint-star')).toBeVisible();
      expect((await auditChildPage(page, 'tap')).issues).toEqual([]);
    }
    await page.locator(`.answer-card[data-word-id="${target}"]`).click();
  }
  await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
  await expect(page.locator('.end-stars .earned')).toHaveCount(5);
  expect((await auditChildPage(page, 'tap')).issues).toEqual([]);
  const evidence = await page.evaluate((wordId) => new Promise<{ attempts: number; first?: number }>((resolve, reject) => {
    const request = indexedDB.open('w-english'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const transaction = db.transaction(['attempts', 'wordProgress']);
      const attempts = transaction.objectStore('attempts').getAll(); const progress = transaction.objectStore('wordProgress').get(wordId);
      transaction.oncomplete = () => { db.close(); resolve({ attempts: attempts.result.length, first: progress.result?.firstCorrectAt }); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), firstWord);
  expect(evidence.attempts).toBe(8); expect(evidence.first).toBeUndefined();
});
