import { expect, test, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  const setup = page.getByRole('button', { name: '准备好，一起出发' });
  await expect(setup).toBeVisible();
  await setup.click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible();
  await expect(page.getByRole('img', { name: '猫', exact: true })).toBeVisible();
}
async function openParent(page: Page) {
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(3200); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '陪伴每一个小发现' })).toBeVisible();
}

test('welcome, setup, illustrated cards and real exploration persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /每一个新词/ })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/welcome.png', fullPage: true });
  await enter(page);
  await page.screenshot({ path: 'artifacts/screenshots/scene.png', fullPage: true });
  await expect(page.getByRole('button', { name: '听音选图', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'cat', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '听单词', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /和家人一起读/ }).click();
  await expect(page.getByText('问孩子小猫怎么叫', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/card.png', fullPage: true });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '认识钢笔', exact: true })).toBeVisible();
  await openParent(page);
  await expect(page.locator('.progress-stat').filter({ hasText: '探索过' }).locator('strong')).toHaveText('1词');
  await page.screenshot({ path: 'artifacts/screenshots/parent.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('parent gate requires the complete hold; settings survive reload', async ({ page }) => {
  await enter(page);
  const gate = page.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.click();
  await expect(page.getByRole('heading', { name: '动物之家' })).toBeVisible();
  await gate.hover(); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.move(1, 1); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '动物之家' })).toBeVisible();
  await openParent(page);
  await page.getByRole('combobox', { name: '操作方式', exact: true }).selectOption('drag');
  await page.getByRole('combobox', { name: '学习等级', exact: true }).selectOption('L3');
  await page.getByRole('checkbox', { name: /减少动态效果/ }).check();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已保存。进行中的题组会保持原来的难度。')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/mode-drag/);
  await expect(page.locator('.app')).toHaveClass(/motion-reduced/);
});

test('cached preview reopens offline without pretending that missing audio is ready', async ({ page, context }) => {
  await enter(page); await openParent(page);
  await expect(page.locator('.offline-heading').getByText('图片已保存，语音待准备', { exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'cat', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '猫', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '听单词', exact: true })).toBeDisabled();
});

test('storage failure offers an explicit temporary experience', async ({ page }) => {
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('Storage unavailable', 'SecurityError'); }; });
  await page.goto('/');
  await page.getByRole('button', { name: '临时体验' }).click();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await page.getByRole('button', { name: '准备好，一起出发' }).click();
  await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
  await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible();
  await expect(page.getByText('本次使用临时体验，学习记录不会保存。')).toBeVisible();
});

test('portrait guidance preserves access to parent settings', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '把小小世界横过来' })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('heading', { name: /每一个新词/ })).toBeVisible();
  await expect(page.locator('.orientation-overlay')).toHaveCount(0);
});

test('minimum landscape keeps child controls usable at the configured touch size', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await enter(page);
  const next = await page.getByRole('button', { name: '下一页', exact: true }).boundingBox();
  expect(next!.width).toBeGreaterThanOrEqual(80); expect(next!.height).toBeGreaterThanOrEqual(80);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
  await page.getByRole('button', { name: '认识猫', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'cat', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
  await page.getByRole('button', { name: /和家人一起读/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
  const sound = await page.getByRole('button', { name: '听单词', exact: true }).boundingBox();
  expect(sound!.height).toBeGreaterThanOrEqual(80);
});

test('a broken content index gives a child-facing retry, not an internal schema error', async ({ page }) => {
  await page.route('**/content/index.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ manifestUrl: 'unsafe', sha256: 'bad' }) }));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('小小世界暂时打不开');
  await expect(page.getByRole('status')).not.toContainText('内容索引格式错误');
  await expect(page.getByRole('button', { name: '再试一次', exact: true })).toBeVisible();
});

test('content preparation works without the newer static AbortSignal helpers', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined });
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined });
  });
  await enter(page); await openParent(page);
  await expect(page.locator('.offline-heading').getByText('图片已保存，语音待准备', { exact: true })).toBeVisible();
});
