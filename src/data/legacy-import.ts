import { z } from 'zod';
import type { LearningDatabase } from './database.ts';
import type { TextbookWordEntry } from './content-schema.ts';
import type { DailyLog, Profile, SrsCardState } from '../domain/models.ts';

// 把 memoryApp（xiaoxue-english-memory）的 IndexedDB 只读导入到合并后的应用。
// 旧库名与表结构来自 memoryApp 快照 b43afb31c9485256d2461948c8734b881d799537，导入后不删除旧库。
export const LEGACY_DB_NAME = 'yilin-memory';

const legacyProfileSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), avatar: z.string().min(1), createdAt: z.number(),
  dailyNewTarget: z.number().int().positive(), includeNonCore: z.boolean(), ttsRate: z.number(),
  coins: z.number().int().nonnegative(), streak: z.number().int().nonnegative(),
  lastStudyDay: z.string().nullable(), totalReviews: z.number().int().nonnegative(),
});
const legacyCardSchema = z.object({
  profileId: z.string().min(1), wordId: z.string().min(1),
  repetitions: z.number().int().nonnegative(), ease: z.number(), interval: z.number().nonnegative(), due: z.number(),
  lastReviewed: z.number().nullable(), reviewCount: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(), learned: z.boolean(),
});
const legacyLogSchema = z.object({
  profileId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newLearned: z.number().int().nonnegative(), reviews: z.number().int().nonnegative(), correct: z.number().int().nonnegative(),
});

export interface LegacySnapshot {
  profiles: Profile[];
  cards: SrsCardState[];
  logs: DailyLog[];
  unmappedWordIds: string[]; // 旧库里存在、但新词库没有对应词的条目
}

export interface LegacyImportResult {
  profiles: number;
  cards: number;
  logs: number;
  skippedCards: number;
}

// 不存在旧库时返回 undefined，并且不会顺手创建一个空库。
async function openLegacy(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(LEGACY_DB_NAME, 1); } catch { resolve(undefined); return; }
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onerror = () => resolve(undefined);
    request.onsuccess = () => resolve(request.result);
  });
}

function readAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const all = transaction.objectStore(store).getAll();
    all.onsuccess = () => resolve(all.result as unknown[]);
    all.onerror = () => reject(all.error ?? new Error(`${store} 读取失败`));
  });
}

export async function readLegacySnapshot(map: Record<string, string>, words: readonly TextbookWordEntry[]): Promise<LegacySnapshot | undefined> {
  const db = await openLegacy();
  if (!db) return undefined;
  try {
    const known = new Set(words.map((word) => word.wordId));
    const profiles = (await readAll(db, 'profiles')).flatMap((row) => {
      const parsed = legacyProfileSchema.safeParse(row);
      return parsed.success ? [{ ...parsed.data } as Profile] : [];
    });
    const unmappedWordIds: string[] = [];
    const cards: SrsCardState[] = [];
    for (const row of await readAll(db, 'progress')) {
      const parsed = legacyCardSchema.safeParse(row);
      if (!parsed.success) continue;
      const wordId = map[parsed.data.wordId];
      if (!wordId || !known.has(wordId)) { unmappedWordIds.push(parsed.data.wordId); continue; }
      cards.push({ ...parsed.data, wordId });
    }
    const logs = (await readAll(db, 'dailyLogs')).flatMap((row) => {
      const parsed = legacyLogSchema.safeParse(row);
      return parsed.success ? [{ ...parsed.data } as DailyLog] : [];
    });
    return { profiles, cards, logs, unmappedWordIds: [...new Set(unmappedWordIds)] };
  } finally {
    db.close();
  }
}

// 重复导入幂等：卡片保留 lastReviewed 较新的那份，当日记录逐字段取较大值。
// 档案的处理：还在默认状态的档案会接受旧库的姓名/头像与偏好；已经有自己记录的档案只合并计数（取较大值），不会被改名或回退。
export async function importLegacySnapshot(db: LearningDatabase, snapshot: LegacySnapshot): Promise<LegacyImportResult> {
  let profiles = 0; let cards = 0; let logs = 0; let skippedCards = 0;
  await db.transaction('rw', db.profiles, db.srsProgress, db.dailyLogs, async () => {
    for (const profile of snapshot.profiles) {
      const existing = await db.profiles.get(profile.id);
      if (!existing) { await db.profiles.add(profile); profiles += 1; continue; }
      const untouched = existing.totalReviews === 0 && existing.coins === 0 && existing.streak === 0 && existing.lastStudyDay === null;
      const merged = { ...existing,
        coins: Math.max(existing.coins, profile.coins),
        streak: Math.max(existing.streak, profile.streak),
        totalReviews: Math.max(existing.totalReviews, profile.totalReviews),
        lastStudyDay: (existing.lastStudyDay ?? '') >= (profile.lastStudyDay ?? '') ? existing.lastStudyDay : profile.lastStudyDay,
        ...(untouched ? { name: profile.name, avatar: profile.avatar, dailyNewTarget: profile.dailyNewTarget, includeNonCore: profile.includeNonCore, ttsRate: profile.ttsRate } : {}) };
      if (JSON.stringify(merged) === JSON.stringify(existing)) continue;
      await db.profiles.put(merged); profiles += 1;
    }
    for (const card of snapshot.cards) {
      const existing = await db.srsProgress.get([card.profileId, card.wordId]);
      if (existing && (existing.lastReviewed ?? 0) >= (card.lastReviewed ?? 0)) { skippedCards += 1; continue; }
      await db.srsProgress.put(card); cards += 1;
    }
    for (const log of snapshot.logs) {
      const existing = await db.dailyLogs.get([log.profileId, log.day]);
      if (!existing) { await db.dailyLogs.put(log); logs += 1; continue; }
      if (existing.newLearned >= log.newLearned && existing.reviews >= log.reviews && existing.correct >= log.correct) continue;
      await db.dailyLogs.put({ ...existing,
        newLearned: Math.max(existing.newLearned, log.newLearned),
        reviews: Math.max(existing.reviews, log.reviews),
        correct: Math.max(existing.correct, log.correct) });
      logs += 1;
    }
  });
  return { profiles, cards, logs, skippedCards };
}
