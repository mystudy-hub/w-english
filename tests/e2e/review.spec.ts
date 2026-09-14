import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { loadReviewData, reviewIdentity } from '../../scripts/lib/review-data.mjs';
import { renderReviewPage } from '../../scripts/lib/review-page.mjs';
import { syntheticContent } from '../helpers/synthetic-content.ts';

test.use({ serviceWorkers: 'block' });
async function show(page: Page, html: string) {
  await page.route('**/review-test', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('/review-test');
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出审核结果', exact: true }).click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('review page starts pending, exports only explicit approval, and records a withdrawal', async ({ page }) => {
  const data = await loadReviewData();
  const pendingData = structuredClone(data);
  for (const c of pendingData.clips) c.available = false;
  pendingData.datasetSha256 = reviewIdentity(pendingData);
  await show(page, await renderReviewPage(pendingData));
  await expect(page.getByRole('heading', { name: '素材审核工作台' })).toBeVisible();
  await expect(page.getByRole('img', { name: '猫', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/review.png', fullPage: true });
  expect((await exported(page)).words).toEqual({});
  await page.getByRole('textbox', { name: '审核人', exact: true }).fill('Browser fixture; not a teacher approval');
  await expect(page.getByRole('button', { name: '批准文字与配图', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '已核对词义、例句、拆分、教学提示与配图表达' }).check();
  await page.getByRole('button', { name: '批准文字与配图', exact: true }).click();
  const review = await exported(page);
  expect(Object.keys(review.words)).toEqual(['w_cat_001']); expect(review.clips).toEqual({});
  expect(review.words.w_cat_001.contentSha256).toBe(data.words[0].contentSha256);
  await page.getByRole('textbox', { name: '修改意见 / 备注' }).fill('Test fixture withdrawal');
  await page.getByRole('button', { name: '标记需修改 / 撤回批准', exact: true }).click();
  const rejected = await exported(page);
  expect(rejected.words).toEqual({}); expect(rejected.rejections.w_cat_001.note).toBe('Test fixture withdrawal');
  await page.getByRole('combobox', { name: '审核类别' }).selectOption('clips');
  await expect(page.getByText(/尚未提供最终语音/)).toBeVisible();
  await expect(page.getByRole('button', { name: '批准此语音片段', exact: true })).toHaveCount(0);
});

test('clip approval requires natural playback, review confirmation and source rights', async ({ page }) => {
  const data = await loadReviewData(); const fixture = syntheticContent(); const asset = fixture.manifest.assets['audio:guide']!;
  const clip = data.clips.find((entry: { ref: string }) => entry.ref === 'guide#welcome')!;
  Object.assign(clip, { available: true, interval: [150, 200], spriteSha256: asset.sha256, sourceSha256: 'a'.repeat(64), calibrationRequired: false });
  data.audio.guide = `data:audio/wav;base64,${fixture.files.get(asset.url)!.bytes.toString('base64')}`;
  data.datasetSha256 = reviewIdentity(data);
  await show(page, await renderReviewPage(data));
  await page.getByRole('textbox', { name: '审核人', exact: true }).fill('Browser fixture; not a teacher approval');
  await page.getByRole('combobox', { name: '审核类别' }).selectOption('clips');
  await page.getByRole('searchbox', { name: '查找单词或语音' }).fill('guide#welcome');
  await page.getByRole('button', { name: /^guide#welcome/ }).click();
  await page.getByRole('checkbox', { name: '发音、语速、响度和切片边界通过听审' }).check();
  await expect(page.getByRole('button', { name: '批准此语音片段', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '试听最终切片', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已完整播放 guide#welcome');
  await page.getByRole('textbox', { name: '素材作者 / 权利人', exact: true }).fill('Test generator');
  await page.getByRole('textbox', { name: '适用许可 / 授权名称', exact: true }).fill('Test-only signal');
  await page.getByRole('textbox', { name: '授权依据的位置或文件名', exact: true }).fill('tests/e2e/review.spec.ts');
  await page.getByRole('checkbox', { name: '发音、语速、响度和切片边界通过听审' }).check();
  await page.getByRole('button', { name: '批准此语音片段', exact: true }).click();
  const result = await exported(page);
  expect(result.clips['guide#welcome'].clip).toEqual([150, 200]);
  expect(result.clips['guide#welcome'].spriteSha256).toBe(asset.sha256);
  expect(result.clips['guide#welcome'].promptSha256).toBe(clip.promptSha256);
  expect(Object.keys(result.clips)).toHaveLength(1);
});
