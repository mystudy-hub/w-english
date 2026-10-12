import Dexie from 'dexie';
import type { LearningDatabase } from './database.ts';
import { buildSession, masteryStats, sm2, type MasteryStats, type ReviewGrade, type SessionPlan, type SrsWord } from '../core/srs/index.ts';
import { applyStudyResult, coinsFor, localDay } from '../domain/day.ts';
import { createProfile, defaultProfile } from '../domain/profiles.ts';
import type { DailyLog, Profile, SrsCardState } from '../domain/models.ts';

// drill 轨道只写自己这三张表（profiles / srsProgress / dailyLogs），
// 探索轨道的 sessions、attempts、rewards、wordProgress 一律不碰。
export { localDay };

export interface ReviewOutcome {
  card: SrsCardState;
  wasCorrect: boolean;
  day: string;
  repeated: boolean;
  coins: number;
}

export class DrillRepository {
  readonly db: LearningDatabase;
  private readonly write: <T>(work: () => Promise<T>) => Promise<T>;
  constructor(db: LearningDatabase, write: <T>(work: () => Promise<T>) => Promise<T> = (work) => work()) {
    this.db = db;
    this.write = write;
  }

  profiles(): Promise<Profile[]> { return this.db.profiles.toArray(); }
  profile(id: string): Promise<Profile | undefined> { return this.db.profiles.get(id); }

  saveProfile(profile: Profile) {
    return this.write(async () => { await this.db.profiles.put(profile); return profile; });
  }

  // 新增一个孩子档案；至少保留一个档案，家长不能把最后一个删掉。
  createProfile(input: { name: string; avatar?: string; dailyNewTarget?: number }): Promise<Profile> {
    const profile = createProfile(input);
    return this.write(async () => { await this.db.profiles.add(profile); return profile; });
  }

  updateProfile(id: string, patch: Partial<Omit<Profile, 'id' | 'createdAt'>>): Promise<Profile | undefined> {
    return this.write(async () => {
      const current = await this.db.profiles.get(id);
      if (!current) return undefined;
      const next: Profile = { ...current, ...patch, id: current.id, createdAt: current.createdAt };
      await this.db.profiles.put(next);
      return next;
    });
  }

  // 删除档案连同它的复习进度与每日记录；调用方负责确认不会删掉活动档案。
  async deleteProfile(id: string) {
    await this.write(() => this.db.transaction('rw', this.db.profiles, this.db.srsProgress, this.db.dailyLogs, async () => {
      await this.db.profiles.delete(id);
      await this.db.srsProgress.where('[profileId+wordId]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
      await this.db.dailyLogs.where('[profileId+day]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
    }));
  }

  // 复合主键 [profileId+wordId] 只能按前缀区间查询；Dexie 的 min/maxKey 就是这种前缀边界。
  progress(profileId: string): Promise<SrsCardState[]> {
    return this.db.srsProgress.where('[profileId+wordId]').between([profileId, Dexie.minKey], [profileId, Dexie.maxKey]).toArray();
  }

  due(profileId: string, now: number): Promise<SrsCardState[]> {
    return this.db.srsProgress.where('[profileId+due]').between([profileId, Dexie.minKey], [profileId, now], true, true).toArray();
  }

  dailyLog(profileId: string, day: string): Promise<DailyLog | undefined> {
    return this.db.dailyLogs.get([profileId, day]);
  }

  dailyLogs(profileId: string): Promise<DailyLog[]> {
    return this.db.dailyLogs.where('[profileId+day]').between([profileId, Dexie.minKey], [profileId, Dexie.maxKey]).toArray();
  }

  // 一次复习在一个事务里同时写 SRS 状态、当日记录与档案计分；同一毫秒的重复提交只计一次。
  review(input: { profileId: string; wordId: string; grade: ReviewGrade; retried?: boolean; now?: number }): Promise<ReviewOutcome> {
    const now = input.now ?? Date.now();
    const day = localDay(now);
    return this.write(() => this.db.transaction('rw', this.db.profiles, this.db.srsProgress, this.db.dailyLogs, async () => {
      const existing = await this.db.srsProgress.get([input.profileId, input.wordId]);
      if (existing && existing.lastReviewed === now) {
        return { card: existing, wasCorrect: input.grade !== 'again', day, repeated: true, coins: 0 };
      }
      const card: SrsCardState = existing ?? { ...sm2.init(input.wordId), profileId: input.profileId };
      const { next, wasCorrect } = sm2.review(card, input.grade, now);
      const stored: SrsCardState = { ...next, profileId: input.profileId };
      await this.db.srsProgress.put(stored);
      const log = await this.db.dailyLogs.get([input.profileId, day])
        ?? { profileId: input.profileId, day, newLearned: 0, reviews: 0, correct: 0 };
      await this.db.dailyLogs.put({ ...log,
        newLearned: log.newLearned + (card.learned ? 0 : 1),
        reviews: log.reviews + 1,
        correct: log.correct + (wasCorrect ? 1 : 0) });
      const coins = coinsFor(input.grade, Boolean(input.retried));
      const profile = await this.db.profiles.get(input.profileId) ?? defaultProfile(input.profileId);
      await this.db.profiles.put(applyStudyResult(profile, { coins, reviews: 1, now }));
      return { card: stored, wasCorrect, day, repeated: false, coins };
    }));
  }

  // 今日计划：先到期复习，再按每日目标取新词；错词本专项直接给 wordIds。
  async plan(input: { profileId: string; words: readonly SrsWord[]; dailyNewTarget: number; includeNonCore: boolean; unit?: number; wordIds?: readonly string[]; now?: number }): Promise<SessionPlan> {
    const cards = await this.progress(input.profileId);
    const progress = new Map(cards.map((card) => [card.wordId, card]));
    return buildSession({ words: input.words, progress, dailyNewTarget: input.dailyNewTarget, includeNonCore: input.includeNonCore,
      unit: input.unit, wordIds: input.wordIds, now: input.now });
  }

  async mastery(input: { profileId: string; words: readonly SrsWord[]; includeNonCore: boolean; now?: number }): Promise<MasteryStats> {
    const cards = await this.progress(input.profileId);
    return masteryStats({ words: input.words, progress: new Map(cards.map((card) => [card.wordId, card])),
      includeNonCore: input.includeNonCore, now: input.now });
  }
}
