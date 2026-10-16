import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { fixtureServer } from '../helpers/fixture-server.ts';

async function controlled(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('a replacement worker waits while any previous controlled window remains open', async ({ page, context }) => {
  test.setTimeout(180_000); // Service Worker 生命周期 + 独立静态服务器，满载机器上比常规用例慢得多
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
    // 关闭全部旧窗口后，等待中的替换版才可能接管。若新开的窗口仍被旧版控制，
    // 它会反过来继续挡住激活，所以这里「开一次、问一次、不行就关掉重来」。
    const askVersion = (target: Page) => target.evaluate(async () => {
      return new Promise<string>((resolve) => {
        const channel = new MessageChannel(); const timeout = setTimeout(() => { channel.port1.close(); resolve('waiting'); }, 500);
        channel.port1.onmessage = (event) => { clearTimeout(timeout); channel.port1.close(); resolve(String(event.data)); };
        navigator.serviceWorker.controller!.postMessage('test-worker-version', [channel.port2]);
      });
    });
    let reopened: Page | undefined;
    for (let attempt = 0; attempt < 3 && !reopened; attempt += 1) {
      const candidate = await context.newPage();
      // 先不导航：此时没有任何客户端，浏览器才有机会让替换版完成激活；
      // 若抢在激活前导航，新窗口会被旧版控制，反过来继续挡住激活。
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await candidate.goto(server.origin); await controlled(candidate);
      if (await askVersion(candidate) === 'replacement') reopened = candidate; else await candidate.close();
    }
    expect(reopened, '替换版 Service Worker 未在重试内接管').toBeDefined();
    await expect(reopened!.getByRole('heading', { name: /每一个新词/ })).toBeVisible();
    await reopened!.close();
  } finally { for (const open of context.pages()) await open.close(); await server.close(); }
});
