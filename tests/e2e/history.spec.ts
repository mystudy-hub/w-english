import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { SessionSnapshot } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { localRecords, openParentWithClock } from '../helpers/local-records.ts';

test.use({ serviceWorkers: 'block' });
test('parent export, cancel and clear preserve settings, rest timing and downloaded content', async ({ page }) => {
  const fixture = syntheticContent({ scenes: true });
  await page.clock.install();
  await page.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await openParentWithClock(page);
  await page.getByRole('combobox', { name: '向导陪伴', exact: true }).selectOption('false');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('设置已保存。进行中的题组会保持原来的难度。')).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '听音选图', exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(page.locator('.answer-card').first()).toBeEnabled();
    const round = (await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.status === 'active')!;
    await page.locator(`.answer-card[data-word-id="${round.questions[index]!.wordId}"]`).click();
  }
  await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible();
  await openParentWithClock(page);
  const savedSettings = await localRecords(page, 'settings'); const savedUsage = await localRecords(page, 'activityState');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本机学习记录' }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.attempts).toHaveLength(5); expect(exported.rewards.filter((reward: { kind: string }) => reward.kind === 'sticker')).toHaveLength(1);
  await page.getByRole('button', { name: '清除本机学习记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '清除本机学习记录？' });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '保留记录' }).click();
  expect(await localRecords(page, 'attempts')).toHaveLength(5);
  await page.getByRole('button', { name: '清除本机学习记录', exact: true }).click();
  await dialog.getByRole('button', { name: '确认清除学习记录', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.progress-stat strong')).toHaveText(['0词', '0词', '0词', '0词']);
  for (const table of ['attempts', 'sessions', 'rewards', 'wordProgress']) expect(await localRecords(page, table)).toEqual([]);
  expect(await localRecords(page, 'settings')).toEqual(savedSettings);
  expect(await localRecords(page, 'activityState')).toEqual(savedUsage);
  expect(await page.evaluate(async (url) => Boolean(await caches.match(new URL(url, location.href))), fixture.manifest.assets['audio:animal_home']!.url)).toBe(true);
  await page.reload(); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByRole('button', { name: '阳光花园尚未开放' })).toBeDisabled();
  expect(await localRecords(page, 'rewards')).toEqual([]);
});
