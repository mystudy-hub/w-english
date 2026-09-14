import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { DATABASE_SCHEMA_VERSION, LearningDatabase, VERSION_ONE_STORES } from '../src/data/database.ts';
import { LearningRepository } from '../src/data/learning-repository.ts';
import { defaultGuide, defaultSettings } from '../src/domain/config.ts';
import { defaultUsage } from '../src/domain/usage.ts';
import { exportLocalBackup } from '../src/services/local-backup.ts';

it('migrates the exact v1 schema without rewriting any of its seven tables', async () => {
  const name = `migration-${crypto.randomUUID()}`; const old = new Dexie(name);
  old.version(1).stores(VERSION_ONE_STORES); await old.open();
  const settings = defaultSettings(); settings.parentSettings.screenTimeMinutes = 18; settings.onboardingComplete = true;
  await old.table('settings').put(settings); await old.table('guideState').put(defaultGuide());
  await old.table('wordProgress').put({ wordId: 'w_cat_001', heardCount: 7, firstCorrectAt: 1000, reviewCorrectAt: 90_000_000 });
  await old.table('sessions').put({ id: 'old-round', status: 'active', currentQuestionIndex: 1, questions: [{ id: 'first', state: 'completed' }, { id: 'second', state: 'loading' }], updatedAt: 2000 });
  await old.table('attempts').put({ id: 'first:1', questionId: 'first', sessionId: 'old-round', wordId: 'w_cat_001', ts: 1000 });
  await old.table('rewards').put({ id: 'first:participation', sessionId: 'old-round', kind: 'participation' });
  await old.table('contentPacks').put({ id: 'pinned', state: 'active', contentVersion: '2026.09.2', updatedAt: 1000 });
  old.close(); const before = await exportLocalBackup(name);
  const current = new LearningDatabase(name);
  try {
    await new LearningRepository(current).initialize();
    const after = await exportLocalBackup(name);
    expect(after.databaseVersion).toBe(DATABASE_SCHEMA_VERSION * 10);
    for (const table of Object.keys(VERSION_ONE_STORES)) expect(after.tables[table]).toEqual(before.tables[table]);
    expect(after.tables.activityState).toEqual([defaultUsage(18)]);
  } finally { await current.delete(); }
});

it.each(['unknown-store', 'wrong-index'] as const)('aborts an unknown version-10 layout before migration: %s', async (layout) => {
  const name = `unknown-v1-${crypto.randomUUID()}`; const old = new Dexie(name);
  old.version(1).stores(layout === 'unknown-store' ? { oldProgress: 'id' } : { ...VERSION_ONE_STORES, attempts: 'id, questionId, sessionId, wordId, ts' });
  await old.open(); await old.table(layout === 'unknown-store' ? 'oldProgress' : 'settings').put(layout === 'unknown-store' ? { id: 'kept', data: 7 } : defaultSettings());
  old.close(); const before = await exportLocalBackup(name); const current = new LearningDatabase(name);
  try {
    await expect(current.open()).rejects.toThrow(); current.close();
    const after = await exportLocalBackup(name);
    expect(after.databaseVersion).toBe(10); expect(after.tables).toEqual(before.tables);
    expect(after.tables.activityState).toBeUndefined();
  } finally { current.close(); await Dexie.delete(name); }
});

it('rolls back a failed known-schema upgrade and can retry without losing old progress', async () => {
  const name = `failed-upgrade-${crypto.randomUUID()}`; const old = new Dexie(name);
  old.version(1).stores(VERSION_ONE_STORES); await old.open();
  await old.table('settings').put(defaultSettings());
  await old.table('wordProgress').put({ wordId: 'w_cat_001', heardCount: 3, exploredAt: 1000, firstCorrectAt: 2000 });
  old.close(); const before = await exportLocalBackup(name); const current = new LearningDatabase(name);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'activityState') throw new DOMException('Private migration quota fixture', 'QuotaExceededError');
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  try {
    await expect(current.open()).rejects.toThrow(); current.close(); failure.mockRestore();
    const rolledBack = await exportLocalBackup(name);
    expect(rolledBack.databaseVersion).toBe(10); expect(rolledBack.tables).toEqual(before.tables);
    await new LearningRepository(current).initialize();
    expect(await current.wordProgress.toArray()).toEqual(before.tables.wordProgress);
    expect(await current.activityState.get('local')).toEqual(defaultUsage());
  } finally { failure.mockRestore(); await current.delete(); }
});
