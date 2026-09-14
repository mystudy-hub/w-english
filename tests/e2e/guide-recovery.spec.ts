import { expect, test, type Page } from '@playwright/test';
import type { SpriteManifest } from '../../src/data/content-schema.ts';
import type { GuideState, WordProgress } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { localRecords } from '../helpers/local-records.ts';

test.use({ serviceWorkers: 'block' });

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { testAudioStarts: Array<{ offset: number; bufferSeconds: number }> };
    state.testAudioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      state.testAudioStarts.push({ offset: offset ?? 0, bufferSeconds: this.buffer?.duration ?? 0 });
      start.call(this, when, offset, duration);
    };
  });
}
function guideSprite(fixture: ReturnType<typeof syntheticContent>): SpriteManifest {
  return JSON.parse(fixture.files.get(fixture.manifest.assets[fixture.manifest.sprites.guide!]!.url)!.bytes.toString('utf8'));
}
async function expectGuide(page: Page, fixture: ReturnType<typeof syntheticContent>, cue: string) {
  const sprite = guideSprite(fixture);
  await expect.poll(() => page.evaluate(({ offset, seconds }) => {
    const state = window as unknown as { testAudioStarts: Array<{ offset: number; bufferSeconds: number }> };
    return state.testAudioStarts.some((entry) => Math.abs(entry.offset - offset) < .001 && Math.abs(entry.bufferSeconds - seconds) < .001);
  }, { offset: sprite.sprite[cue]![0] / 1000, seconds: sprite.durationMs / 1000 })).toBe(true);
}

test('the world selector plays its own idle guidance without creating learning evidence', async ({ page }) => {
  const fixture = syntheticContent({ scenes: true }); await observeAudio(page); await page.clock.install();
  await page.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await expect.poll(async () => (await localRecords<GuideState>(page, 'guideState'))[0]?.completedStepIds.includes('welcome')).toBe(true);
  await page.clock.fastForward(9000); await expectGuide(page, fixture, 'choose_world');
  expect(await localRecords(page, 'wordProgress')).toEqual([]); expect(await localRecords(page, 'attempts')).toEqual([]);
});

test('an audio loading failure offers retry narration and a successful retry alone counts as heard', async ({ page }) => {
  const fixture = syntheticContent({ scenes: true }); await observeAudio(page);
  let failed = false;
  await page.route('**/content/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!failed && path === fixture.manifest.assets['audio:animal_home']!.url && route.request().resourceType() === 'xhr') {
      failed = true; await route.fulfill({ status: 503, body: 'Private test failure' }); return;
    }
    const file = fixture.files.get(path);
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await page.getByRole('button', { name: '听单词', exact: true }).click();
  await expect(page.getByText('再点一下小喇叭试试吧。', { exact: true })).toBeVisible();
  await expectGuide(page, fixture, 'audio_retry');
  expect(failed).toBe(true);
  expect((await localRecords<WordProgress>(page, 'wordProgress')).find((word) => word.wordId === 'w_cat_001')?.heardCount).toBe(0);
  await page.getByRole('button', { name: '听单词', exact: true }).click();
  await expect.poll(async () => (await localRecords<WordProgress>(page, 'wordProgress')).find((word) => word.wordId === 'w_cat_001')?.heardCount).toBe(1);
});

test('offline startup without a usable content pack offers the cached core guide and a visible retry', async ({ page }) => {
  const fixture = syntheticContent(); await observeAudio(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); });
  const original = fixture.manifest.assets['audio:guide']!; const asset = { ...original, url: `core/test-guide.${original.sha256.slice(0, 16)}.wav` };
  await page.route('**/core/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/core/index.json') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coreVersion: 1, assets: { 'audio:guide': asset }, sprites: { guide: guideSprite(fixture) } }) });
    } else await route.fulfill({ status: 200, contentType: 'audio/wav', body: fixture.files.get(original.url)!.bytes });
  });
  await page.route('**/content/**', (route) => route.fulfill({ status: 503, body: 'Private offline fixture' }));
  await page.goto('/');
  await expect(page.getByText('先连上网，把小伙伴们带来，再一起出发吧。')).toBeVisible();
  await expect(page.getByRole('button', { name: '再试一次', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '听离线提示', exact: true }).click();
  await expectGuide(page, fixture, 'offline');
  expect(await localRecords(page, 'wordProgress')).toEqual([]);
});
