import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { auditChildPage } from '../helpers/accessibility.ts';
import { CORE_GUIDE_SPRITE } from '../../src/domain/guide-content.ts';
import { localRecords, openParentWithClock } from '../helpers/local-records.ts';

test.use({ serviceWorkers: 'block' });
for (const mode of ['tap', 'drag'] as const) {
  test(`${mode}: child screens meet touch, learning text and contrast requirements at 960×600`, async ({ page }, info) => {
    test.setTimeout(60_000);
    const fixture = syntheticContent({ fullCatalog: true });
    await page.setViewportSize({ width: 960, height: 600 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.install();
    await page.route('**/content/**', async (route) => {
      const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
      if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
    });
    const samples: Array<{ page: string } & Awaited<ReturnType<typeof auditChildPage>>> = [];
    await mkdir('artifacts/accessibility', { recursive: true });
    const audit = async (name: string) => {
      await page.mouse.move(0, 0); const result = await auditChildPage(page, mode); samples.push({ page: name, ...result });
      await writeFile(`artifacts/accessibility/${mode}.json`, JSON.stringify({ mode, samples }, null, 2));
      expect.soft(result.controls, name).toBeGreaterThan(0);
      expect.soft(result.issues, name).toEqual([]);
      if (mode === 'tap') expect.soft(await page.locator('.app [data-mode-label]').evaluateAll((elements) => elements.every((element) => !element.getClientRects().length)), `${name}: tap labels are hidden`).toBe(true);
      if (name === 'rest') expect.soft(await page.getByRole('dialog').evaluate((node) => {
        const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && node.scrollHeight <= node.clientHeight + 2;
      }), 'rest dialog fits minimum landscape').toBe(true);
      else if (name !== 'stickers') expect.soft(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2), `${name}: fits minimum landscape`).toBe(true);
      if (name === 'co-reading') await page.screenshot({ path: `artifacts/screenshots/accessibility-${mode}.png`, fullPage: true });
    };
    await page.goto('/'); await expect(page.getByRole('button', { name: '开始冒险', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    if (mode === 'drag') await page.getByRole('button', { name: /自己来探索/ }).click();
    await page.getByRole('button', { name: /L3.*进阶/ }).click();
    await page.getByRole('button', { name: '准备好，一起出发' }).click();
    await expect(page.getByRole('heading', { name: '今天，想去哪里看看？' })).toBeVisible(); await audit('themes');
    await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
    await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible(); await audit('scene');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const element = document.activeElement; if (!element || !element.matches('button, a')) return false;
      const style = getComputedStyle(element); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    })).toBe(true);
    await page.getByRole('button', { name: '认识猫', exact: true }).click(); await audit('card');
    await page.getByRole('button', { name: /和家人一起读/ }).click(); await audit('co-reading');
    await page.getByRole('button', { name: /和家人一起读/ }).click();
    await page.evaluate(() => { location.hash = '/word/w_turtle_027'; });
    await expect(page.getByRole('heading', { name: 'turtle', exact: true })).toBeVisible(); await audit('longer-word');
    await page.getByRole('button', { name: '拼读泡泡', exact: true }).click(); await audit('phonics');
    await page.getByRole('button', { name: '拼这个单词', exact: true }).click();
    await expect(page.locator('.letter-tile').first()).toBeEnabled(); await audit('spelling');
    await page.getByRole('button', { name: '看看完整单词', exact: true }).click();
    await page.getByRole('button', { name: '认识下一位', exact: true }).click();
    await expect(page.getByRole('heading', { name: '小小的你，发现了大大的世界。' })).toBeVisible(); await audit('round-end');
    await page.getByRole('button', { name: '贴纸图鉴', exact: true }).click(); await audit('stickers');
    // The static gallery has no teaching playback; time never substitutes for hearing a word.
    await page.clock.fastForward(8 * 60_000 + 1000);
    await expect(page.getByRole('dialog', { name: '让小眼睛休息一下' })).toBeVisible(); await audit('rest');
    const body = JSON.stringify({ mode, viewport: { width: 960, height: 600 }, samples }, null, 2);
    await mkdir('artifacts/accessibility', { recursive: true }); await writeFile(`artifacts/accessibility/${mode}.json`, body);
    await info.attach(`accessibility-${mode}`, { body, contentType: 'application/json' });
  });
}

test('safe insets determine usable space; orientation guidance traps focus and preserves parent access', async ({ page }) => {
  const fixture = syntheticContent({ fullCatalog: true });
  await page.setViewportSize({ width: 1024, height: 650 }); await page.clock.install(); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const state = window as unknown as { uiAudioStarts: Array<{ offset: number; duration: number }> }; state.uiAudioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      state.uiAudioStarts.push({ offset: offset ?? 0, duration: this.buffer?.duration ?? 0 }); start.call(this, when, offset, duration);
    };
  });
  await page.route('**/content/**', async (route) => {
    const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
    if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
  });
  await page.goto('/'); await page.addStyleTag({ content: ':root{--safe-top:12px;--safe-right:28px;--safe-bottom:20px;--safe-left:36px}' });
  await page.evaluate(() => dispatchEvent(new Event('resize')));
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll('.app button, .app a.brand')].filter((element) => element.getClientRects().length).every((element) => {
    const box = element.getBoundingClientRect(); return box.left >= 36 && box.right <= innerWidth - 28 && box.top >= 12 && box.bottom <= innerHeight - 20;
  }))).toBe(true);
  await page.setViewportSize({ width: 960, height: 650 });
  const dialog = page.getByRole('dialog', { name: '把小小世界横过来' }); await expect(dialog).toBeVisible();
  expect((await auditChildPage(page, 'tap')).issues).toEqual([]);
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Tab'); expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  const sprite = JSON.parse(fixture.files.get(fixture.manifest.assets[fixture.manifest.sprites[CORE_GUIDE_SPRITE]!]!.url)!.bytes.toString('utf8'));
  await dialog.getByRole('button', { name: '听横屏提示', exact: true }).click();
  await expect.poll(() => page.evaluate(({ offset, duration }) => (window as unknown as { uiAudioStarts: Array<{ offset: number; duration: number }> }).uiAudioStarts
    .some((entry) => Math.abs(entry.offset - offset) < .001 && Math.abs(entry.duration - duration) < .001),
  { offset: sprite.sprite.rotate[0] / 1000, duration: sprite.durationMs / 1000 })).toBe(true);
  await page.screenshot({ path: 'artifacts/screenshots/safe-area.png', fullPage: true });
  expect(await localRecords(page, 'wordProgress')).toEqual([]);
  await openParentWithClock(page, dialog);
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('heading', { name: '陪伴每一个小发现' })).toBeVisible();
});
