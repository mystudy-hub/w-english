import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textbookWordsSchema, type TextbookWordEntry } from '../src/data/content-schema.ts';
import { LearningDatabase } from '../src/data/database.ts';
import { LEGACY_DB_NAME, importLegacySnapshot, readLegacySnapshot } from '../src/data/legacy-import.ts';
import { defaultProfile } from '../src/domain/profiles.ts';

const mapFile = JSON.parse(readFileSync('data/textbook/legacy-id-map.json', 'utf8')) as { words: Record<string, string> };
const catalogue = JSON.parse(readFileSync('data/textbook/catalog.json', 'utf8')) as { units: { words: string }[] };
const words: TextbookWordEntry[] = catalogue.units.flatMap((unit) => textbookWordsSchema.parse(JSON.parse(readFileSync(unit.words, 'utf8'))));
const byId = new Map(words.map((word) => [word.wordId, word]));

function openLegacyStore(rows: { profiles?: unknown[]; progress?: unknown[]; dailyLogs?: unknown[] }) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('profiles', { keyPath: 'id' });
      db.createObjectStore('progress', { keyPath: 'key' });
      db.createObjectStore('dailyLogs', { keyPath: 'key' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const stores = Object.entries(rows).filter(([, value]) => value?.length);
      if (!stores.length) { resolve(db); return; }
      const transaction = db.transaction(stores.map(([name]) => name), 'readwrite');
      for (const [name, value] of stores) for (const row of value!) transaction.objectStore(name).put(row);
      transaction.oncomplete = () => resolve(db);
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

const legacyProfile = { id: 'p_default', name: '哥哥', avatar: '🐯', createdAt: 1, dailyNewTarget: 12, includeNonCore: true, ttsRate: 0.8, coins: 12, streak: 3, lastStudyDay: '2026-09-30', totalReviews: 26 };
const legacyCard = (legacyWordId: string, extra: Record<string, unknown> = {}) => ({ key: `p_default::${legacyWordId}`, profileId: 'p_default', wordId: legacyWordId, bookId: 'yilin-4a-2024',
  repetitions: 2, ease: 2.4, interval: 3, due: 1_700_000_000_000, lastReviewed: 1_699_000_000_000, reviewCount: 4, lapses: 1, learned: true, ...extra });

let db: LearningDatabase;
beforeEach(() => { db = new LearningDatabase(`legacy-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); await new Promise<void>((resolve) => { const request = indexedDB.deleteDatabase(LEGACY_DB_NAME); request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve(); }); });

describe('memoryApp legacy import', () => {
  it('maps every legacy word id onto the textbook catalogue', () => {
    expect(Object.keys(mapFile.words)).toHaveLength(172);
    for (const [legacyId, wordId] of Object.entries(mapFile.words)) {
      const word = byId.get(wordId);
      expect(word, `${legacyId} → ${wordId}`).toBeDefined();
      // 旧 id 的前缀就是单元号，映射不能跨单元
      expect(legacyId.startsWith(`u${word!.textbook.unit}-`)).toBe(true);
    }
    expect(byId.get(mapFile.words['u2-day']!)?.word).toBe('day');
    expect(byId.get(mapFile.words['u1-subject']!)?.word).toBe('subject');
    expect(byId.get(mapFile.words['u8-kitty']!)?.word).toBe('Kitty');
  });

  it('returns undefined when the legacy database was never used', async () => {
    expect(await readLegacySnapshot(mapFile.words, words)).toBeUndefined();
  });

  it('reads profiles, progress and daily logs, and reports unknown legacy words', async () => {
    const legacy = await openLegacyStore({
      profiles: [legacyProfile],
      progress: [legacyCard('u2-day'), legacyCard('u9-unknown', { key: 'p_default::u9-unknown' })],
      dailyLogs: [{ key: 'p_default::2026-09-30', profileId: 'p_default', day: '2026-09-30', newLearned: 5, reviews: 9, correct: 8 }],
    });
    legacy.close();
    const snapshot = await readLegacySnapshot(mapFile.words, words);
    expect(snapshot?.profiles).toHaveLength(1);
    expect(snapshot?.profiles[0]).toMatchObject({ id: 'p_default', coins: 12, streak: 3, totalReviews: 26 });
    expect(snapshot?.cards).toHaveLength(1);
    expect(snapshot?.cards[0]).toMatchObject({ profileId: 'p_default', wordId: mapFile.words['u2-day'], repetitions: 2, lapses: 1 });
    expect(snapshot?.logs[0]).toMatchObject({ day: '2026-09-30', newLearned: 5, correct: 8 });
    expect(snapshot?.unmappedWordIds).toEqual(['u9-unknown']);
  });

  it('imports the snapshot into the merged database', async () => {
    const legacy = await openLegacyStore({
      profiles: [legacyProfile],
      progress: [legacyCard('u2-day'), legacyCard('u2-get-up', { key: 'p_default::u2-get-up', repetitions: 1, interval: 1, lastReviewed: 1_699_500_000_000 })],
      dailyLogs: [{ key: 'p_default::2026-09-30', profileId: 'p_default', day: '2026-09-30', newLearned: 5, reviews: 9, correct: 8 }],
    });
    legacy.close();
    await db.open();
    const snapshot = (await readLegacySnapshot(mapFile.words, words))!;
    const result = await importLegacySnapshot(db, snapshot);
    expect(result).toEqual({ profiles: 1, cards: 2, logs: 1, skippedCards: 0 });
    expect((await db.profiles.toArray()).map((profile) => profile.id)).toEqual(['p_default']);
    expect(await db.srsProgress.count()).toBe(2);
    expect(await db.dailyLogs.get(['p_default', '2026-09-30'])).toMatchObject({ newLearned: 5, reviews: 9, correct: 8 });
  });

  it('adopts the legacy identity when the local profile is untouched', async () => {
    const legacy = await openLegacyStore({ profiles: [legacyProfile] });
    legacy.close();
    await db.open();
    await db.profiles.put({ ...defaultProfile(), createdAt: 5 });
    const snapshot = (await readLegacySnapshot(mapFile.words, words))!;
    expect((await importLegacySnapshot(db, snapshot)).profiles).toBe(1);
    expect(await db.profiles.get('p_default')).toMatchObject({ name: '哥哥', avatar: '🐯', dailyNewTarget: 12, includeNonCore: true, ttsRate: 0.8, coins: 12, streak: 3, totalReviews: 26, lastStudyDay: '2026-09-30' });
  });

  it('keeps a profile that is already in use, but takes the larger counters', async () => {
    const legacy = await openLegacyStore({ profiles: [legacyProfile] });
    legacy.close();
    await db.open();
    await db.profiles.put({ ...defaultProfile(), name: '妹妹', totalReviews: 5, coins: 2, lastStudyDay: '2026-10-01' });
    const snapshot = (await readLegacySnapshot(mapFile.words, words))!;
    await importLegacySnapshot(db, snapshot);
    expect(await db.profiles.get('p_default')).toMatchObject({ name: '妹妹', coins: 12, streak: 3, totalReviews: 26, lastStudyDay: '2026-10-01' });
  });

  it('is idempotent: a second import neither duplicates nor rewinds progress', async () => {
    const legacy = await openLegacyStore({ profiles: [legacyProfile], progress: [legacyCard('u2-day')],
      dailyLogs: [{ key: 'p_default::2026-09-30', profileId: 'p_default', day: '2026-09-30', newLearned: 5, reviews: 9, correct: 8 }] });
    legacy.close();
    await db.open();
    const snapshot = (await readLegacySnapshot(mapFile.words, words))!;
    await importLegacySnapshot(db, snapshot);
    // 新库里同一个词已经更新到更晚的时间
    await db.srsProgress.put({ ...snapshot.cards[0]!, repetitions: 9, interval: 30, lastReviewed: 1_800_000_000_000 });
    await db.dailyLogs.put({ profileId: 'p_default', day: '2026-09-30', newLearned: 7, reviews: 12, correct: 11 });
    const second = await importLegacySnapshot(db, snapshot);
    expect(second).toMatchObject({ profiles: 0, cards: 0, logs: 0, skippedCards: 1 });
    expect(await db.srsProgress.count()).toBe(1);
    expect((await db.srsProgress.get(['p_default', mapFile.words['u2-day']!]))!.interval).toBe(30);
    expect(await db.dailyLogs.get(['p_default', '2026-09-30'])).toMatchObject({ newLearned: 7, reviews: 12, correct: 11 });
  });
});
