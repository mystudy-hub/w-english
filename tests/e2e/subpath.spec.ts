import { build } from 'vite';
import { expect, test } from '@playwright/test';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';

const directory = '.cache/e2e-subpath-dist';
test.beforeAll(async () => {
  test.setTimeout(60_000);
  await build({ base: '/w-english/', mode: 'preview', build: { outDir: directory }, logLevel: 'error' });
});
test('an actual subpath build keeps its assets, scope and card navigation offline', async ({ page, context }) => {
  const server = await fixtureServer(syntheticContent({ audio: false }), { directory, base: '/w-english/' });
  try {
    await page.goto(`${server.origin}/w-english/`);
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await page.getByRole('button', { name: '准备好，一起出发' }).click();
    await page.getByRole('button', { name: '认识猫', exact: true }).click();
    await expect(page.getByRole('img', { name: '猫', exact: true })).toBeVisible();
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${server.origin}/w-english/`);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true); await page.reload();
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'cat', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: '猫', exact: true })).toBeVisible();
    expect(server.requests.some((path) => path.startsWith('content/images/cat.'))).toBe(true);
    await expect(page.getByRole('button', { name: '听单词', exact: true })).toBeDisabled();
  } finally { await context.setOffline(false); await page.close(); await server.close(); }
});
