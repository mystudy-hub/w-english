import { expect, test } from '@playwright/test';
import type { SessionSnapshot } from '../../src/domain/models.ts';
import { syntheticContent } from '../helpers/synthetic-content.ts';
import { localRecords } from '../helpers/local-records.ts';

test.use({ serviceWorkers: 'block' });

for (const activity of ['listen', 'spell'] as const) {
  test(`${activity}: a failed exit keeps the round usable and a retry archives it once`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put; let failed = false;
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (this.name === 'sessions' && !failed && value && typeof value === 'object' && 'status' in value && value.status === 'abandoned') {
          failed = true; throw new DOMException('Private test: failed exit write', 'QuotaExceededError');
        }
        return key === undefined ? put.call(this, value) : put.call(this, value, key);
      };
    });
    const fixture = syntheticContent({ scenes: true });
    await page.route('**/content/**', async (route) => {
      const file = fixture.files.get(new URL(route.request().url()).pathname.slice(1));
      if (file) await route.fulfill({ status: 200, contentType: file.mime, body: file.bytes }); else await route.continue();
    });
    await page.goto('/'); await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await page.getByRole('button', { name: '准备好，一起出发' }).click();
    await page.getByRole('button', { name: '进入动物之家', exact: true }).click();
    await page.getByRole('button', { name: activity === 'listen' ? '听音选图' : '拼字母', exact: true }).click();
    const choices = page.locator(activity === 'listen' ? '.answer-card' : '.letter-tile');
    await expect(choices.first()).toBeEnabled();
    const original = (await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.status === 'active')!;
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByText(/这一轮还没有结束成功/)).toBeVisible();
    expect((await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.id === original.id)?.status).toBe('active');
    await page.getByRole('button', { name: activity === 'listen' ? '重播题目声音' : '重播拼字单词', exact: true }).click();
    await expect(choices.first()).toBeEnabled();
    const resumed = (await localRecords<SessionSnapshot>(page, 'sessions')).find((session) => session.status === 'active')!;
    expect(resumed.id).toBe(original.id); expect(resumed.currentQuestionIndex).toBe(0);
    expect(await localRecords(page, 'attempts')).toEqual([]); expect(await localRecords(page, 'rewards')).toEqual([]);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByRole('heading', { name: '动物之家', level: 1 })).toBeVisible();
    const archived = await localRecords<SessionSnapshot>(page, 'sessions');
    expect(archived).toHaveLength(1); expect(archived[0]?.status).toBe('abandoned'); expect(errors).toEqual([]);
  });
}
