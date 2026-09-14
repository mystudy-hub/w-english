import { expect, it, vi } from 'vitest';
import { exportLocalBackup } from '../src/services/local-backup.ts';
import { DATABASE_SCHEMA_VERSION, LearningDatabase } from '../src/data/database.ts';

it('exports an unknown newer database read-only, without opening it as the application schema', async () => {
  const name = `future-${crypto.randomUUID()}`;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 50); request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { request.result.createObjectStore('futureProgress', { keyPath: 'id' }).put({ id: 'kept', count: 7 }); };
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  const backup = await exportLocalBackup(name);
  expect(backup.databaseVersion).toBe(50); expect(backup.tables.futureProgress).toEqual([{ id: 'kept', count: 7 }]);
  const current = new LearningDatabase(name);
  expect(await current.open().then(() => 'opened', (error: Error) => error.name)).toBe('VersionError'); current.close();
  expect((await exportLocalBackup(name)).tables).toEqual(backup.tables);
  await new Promise<void>((resolve) => { const deleted = indexedDB.deleteDatabase(name); deleted.onsuccess = () => resolve(); });
});

it('does not create an empty learning database when no backup exists', async () => {
  const name = `missing-${crypto.randomUUID()}`;
  await expect(exportLocalBackup(name)).rejects.toThrow();
  expect((await indexedDB.databases()).some((database) => database.name === name)).toBe(false);
});

it('refuses implicit schema patching at the current version and preserves existing tables', async () => {
  const name = `mismatch-${crypto.randomUUID()}`;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_SCHEMA_VERSION * 10); request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { request.result.createObjectStore('oldProgress', { keyPath: 'id' }).put({ id: 'keep' }); };
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  const current = new LearningDatabase(name);
  expect(await current.open().then(() => 'opened', (error: Error) => error.name)).toBe('SchemaError'); current.close();
  const backup = await exportLocalBackup(name);
  expect(backup.databaseVersion).toBe(DATABASE_SCHEMA_VERSION * 10); expect(backup.tables).toEqual({ oldProgress: [{ id: 'keep' }] });
  await new Promise<void>((resolve) => { const deleted = indexedDB.deleteDatabase(name); deleted.onsuccess = () => resolve(); });
});
