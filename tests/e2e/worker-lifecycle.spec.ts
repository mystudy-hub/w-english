import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';

async function controlled(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('a replacement worker waits while any previous controlled window remains open', async ({ page, context }) => {
  const server = await fixtureServer(syntheticContent({ audio: false }));
  try {
    await page.goto(server.origin); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await page.getByRole('button', { name: '准备好，一起出发' }).click();
    await page.getByRole('button', { name: '认识猫', exact: true }).click(); await controlled(page);
    const second = await context.newPage(); await second.goto(server.origin); await controlled(second);
    const original = await readFile('dist/sw.js');
    const marker = '\nself.addEventListener("message", function(event) { if (event.data === "test-worker-version") event.ports[0].postMessage("replacement"); });\n';
    server.override('sw.js', Buffer.concat([original, Buffer.from(marker)]), 'text/javascript');
    let navigations = 0; page.on('framenavigated', () => { navigations += 1; });
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await expect(page.getByRole('heading', { name: 'cat', exact: true })).toBeVisible(); expect(navigations).toBe(0);
    await page.close();
    await expect.poll(() => second.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await second.close();
    const reopened = await context.newPage(); await reopened.goto(server.origin); await controlled(reopened);
    await expect.poll(() => reopened.evaluate(async () => {
      return new Promise<string>((resolve) => {
        const channel = new MessageChannel(); const timeout = setTimeout(() => { channel.port1.close(); resolve('waiting'); }, 500);
        channel.port1.onmessage = (event) => { clearTimeout(timeout); channel.port1.close(); resolve(String(event.data)); };
        navigator.serviceWorker.controller!.postMessage('test-worker-version', [channel.port2]);
      });
    })).toBe('replacement');
    await expect(reopened.getByRole('heading', { name: /每一个新词/ })).toBeVisible();
    await reopened.close();
  } finally { for (const open of context.pages()) await open.close(); await server.close(); }
});
