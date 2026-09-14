import { expect, type Locator, type Page } from '@playwright/test';

export function localRecords<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open('w-english'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), table);
}

/** The page must have Playwright's clock installed. */
export async function openParentWithClock(page: Page, scope: Page | Locator = page) {
  const gate = scope.getByRole('button', { name: '家长设置，按住三秒' });
  await gate.hover(); await page.mouse.down(); await page.clock.fastForward(3200); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '陪伴每一个小发现' })).toBeVisible();
}
