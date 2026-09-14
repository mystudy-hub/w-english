import { z } from 'zod';
import type { ThemeConfig, WordEntry } from './content-schema.ts';
import { LearningDatabase } from './database.ts';
import { advanceGuide, configSnapshot, defaultGuide, defaultSettings } from '../domain/config.ts';
import { applyLearningEvidence, participationReward, reduceAnswer } from '../domain/learning.ts';
import { createSession } from '../domain/questions.ts';
import { createSpellingSession, placeSpellingTile, spellingPartHeard, spellingReadyToFinish } from '../domain/spelling.ts';
import { missingStickers } from '../domain/stickers.ts';
import { historyRetentionPlan } from '../domain/history-retention.ts';
import { accumulateUsage, changeUsage, defaultUsage, type UsageAction, type UsageCheckpoint } from '../domain/usage.ts';
import type { AttemptRecord, GuideStep, Question, SessionSnapshot, Settings, WordProgress } from '../domain/models.ts';

const settingsSchema = z.strictObject({
  key: z.literal('local'), settingsVersion: z.literal(1), onboardingComplete: z.boolean(),
  interactionMode: z.enum(['tap', 'drag']), learningLevel: z.enum(['L1', 'L2', 'L3']),
  parentSettings: z.strictObject({
    volumeCap: z.number().min(0.4).max(1), reducedMotion: z.boolean(), guideEnabled: z.boolean().nullable(),
    screenTimeMinutes: z.union([z.literal(8), z.literal(12), z.literal(18)]),
    bedtimeMode: z.boolean(), lockLevel: z.boolean(), micEnabled: z.boolean(),
  }),
});

export class LearningRepository {
  readonly db: LearningDatabase;
  private heardEvents = new Map<string, Promise<void>>();
  private readonly write: <T>(work: () => Promise<T>) => Promise<T>;
  constructor(db: LearningDatabase, write: <T>(work: () => Promise<T>) => Promise<T> = (work) => work()) { this.db = db; this.write = write; }
  async initialize(): Promise<Settings> {
    await this.db.open();
    return this.db.transaction('rw', this.db.settings, this.db.guideState, this.db.activityState, async () => {
      const stored = await this.db.settings.get('local');
      const settings = stored ? settingsSchema.parse(stored) : defaultSettings();
      if (!stored) await this.db.settings.add(settings);
      if (!await this.db.guideState.get('local')) await this.db.guideState.add(defaultGuide());
      if (!await this.db.activityState.get('local')) await this.db.activityState.add(defaultUsage(settings.parentSettings.screenTimeMinutes));
      return settings;
    });
  }
  async saveSettings(value: Settings) {
    const validated = settingsSchema.parse(value);
    await this.write(() => this.db.settings.put(validated));
    return validated;
  }
  async settings() { return settingsSchema.parse(await this.db.settings.get('local')); }
  progress() { return this.db.wordProgress.toArray(); }
  activeSession() { return this.db.sessions.where('status').equals('active').first(); }
  session(id: string) { return this.db.sessions.get(id); }
  rewards(sessionId?: string) {
    return sessionId ? this.db.rewards.where('sessionId').equals(sessionId).toArray() : this.db.rewards.toArray();
  }
  async stickers() { return (await this.db.rewards.where('kind').equals('sticker').toArray()).filter((reward) => reward.kind === 'sticker'); }
  private async addMissingStickers(sessionId?: string) {
    const existing = new Set((await this.stickers()).map((reward) => reward.id));
    const additions = missingStickers(await this.progress(), existing, sessionId);
    if (additions.length) await this.db.rewards.bulkAdd(additions);
    return additions;
  }
  reconcileStickers() {
    return this.write(() => this.db.transaction('rw', this.db.wordProgress, this.db.rewards, () => this.addMissingStickers()));
  }
  retainRecentHistory(now: number) {
    return this.write(() => this.db.transaction('rw', this.db.sessions, this.db.attempts, this.db.rewards, async () => {
      const [sessions, attempts, rewards] = await Promise.all([this.db.sessions.toArray(), this.db.attempts.toArray(), this.db.rewards.toArray()]);
      const plan = historyRetentionPlan(sessions, attempts, rewards, now);
      await this.db.attempts.bulkDelete(plan.attemptIds);
      await this.db.rewards.bulkDelete(plan.rewardIds);
      await this.db.sessions.bulkDelete(plan.sessionIds);
      return { attempts: plan.attemptIds.length, sessions: plan.sessionIds.length, participationStars: plan.rewardIds.length };
    }));
  }
  async clearLearningRecords() {
    await this.write(() => this.db.transaction('rw', [this.db.wordProgress, this.db.sessions, this.db.attempts, this.db.rewards, this.db.guideState], async () => {
      await this.db.wordProgress.clear(); await this.db.attempts.clear(); await this.db.rewards.clear(); await this.db.sessions.clear();
      await this.db.guideState.put(defaultGuide());
    }));
    this.heardEvents.clear();
  }
  async usage() { return await this.db.activityState.get('local') ?? defaultUsage(); }
  checkpointUsage(input: UsageCheckpoint) {
    return this.write(() => this.db.transaction('rw', this.db.activityState, async () => {
      const previous = await this.usage(); const next = accumulateUsage(previous, input);
      if (next !== previous) await this.db.activityState.put(next);
      return next;
    }));
  }
  changeUsage(action: UsageAction, cycle: number, now: number) {
    return this.write(() => this.db.transaction('rw', this.db.activityState, this.db.sessions, async () => {
      const previous = await this.usage();
      if (previous.cycle !== cycle) return { usage: previous, session: await this.activeSession() };
      const next = changeUsage(previous, action, now);
      if (next !== previous) {
        await this.db.activityState.put(next);
        await this.db.sessions.where('status').equals('active').modify({ restUntil: next.restUntil });
      }
      return { usage: next, session: await this.activeSession() };
    }));
  }
  async discover(wordId: string, ts: number) {
    await this.write(() => this.db.transaction('rw', this.db.wordProgress, this.db.guideState, async () => {
      const progress = await this.db.wordProgress.get(wordId) ?? { wordId, heardCount: 0 };
      if (progress.exploredAt === undefined) await this.db.wordProgress.put({ ...progress, exploredAt: ts });
      await this.advanceGuideStep('explore_one');
    }));
  }
  heard(wordId: string, playbackId: string) {
    const existing = this.heardEvents.get(playbackId);
    if (existing) return existing;
    const event = this.write(() => this.db.transaction('rw', this.db.wordProgress, this.db.guideState, async () => {
      const progress = await this.db.wordProgress.get(wordId) ?? { wordId, heardCount: 0 };
      await this.db.wordProgress.put({ ...progress, heardCount: progress.heardCount + 1 });
      await this.advanceGuideStep('hear_one');
    })).catch((error: unknown) => { this.heardEvents.delete(playbackId); throw error; });
    this.heardEvents.set(playbackId, event);
    if (this.heardEvents.size > 1_000) this.heardEvents.delete(this.heardEvents.keys().next().value!);
    return event;
  }
  completeGuideStep(step: GuideStep) {
    return this.write(() => this.db.transaction('rw', this.db.guideState, () => this.advanceGuideStep(step)));
  }
  private async advanceGuideStep(step: GuideStep) {
    const previous = await this.db.guideState.get('local') ?? defaultGuide();
    const next = advanceGuide(previous, step);
    await this.db.guideState.put(next);
    return next;
  }
  async startSession(input: {
    id: string; now: number; words: WordEntry[]; theme: ThemeConfig; settings: Settings;
    readyIds: ReadonlySet<string>; random: () => number; reviewOnly?: boolean; release?: boolean; manifestId?: string;
    activity?: 'listenTap' | 'tapSpell';
    focusWordId?: string;
    contentStage?: 0 | 1 | 2;
  }) {
    return this.write(() => this.db.transaction('rw', this.db.sessions, this.db.wordProgress, this.db.guideState, async () => {
      const active = await this.activeSession();
      if (active) return active;
      const create = input.activity === 'tapSpell' ? createSpellingSession : createSession;
      const session = create({ ...input, config: configSnapshot(input.settings.interactionMode, input.settings.learningLevel), progress: await this.progress() });
      if (!session) return null;
      await this.db.sessions.add(session);
      if (input.activity !== 'tapSpell') await this.advanceGuideStep('try_listen');
      return session;
    }));
  }
  private async mutateQuestion(sessionId: string, questionId: string, mutation: (question: Question, session: SessionSnapshot) => Question) {
    return this.write(() => this.db.transaction('rw', this.db.sessions, async () => {
      const session = await this.db.sessions.get(sessionId);
      if (!session || session.status !== 'active') throw new Error('本轮已结束');
      const question = session.questions[session.currentQuestionIndex];
      if (!question || question.id !== questionId) throw new Error('题目已经切换');
      session.questions[session.currentQuestionIndex] = mutation(question, session);
      await this.db.sessions.put(session);
      return session;
    }));
  }
  prepareQuestion(sessionId: string, questionId: string) {
    return this.mutateQuestion(sessionId, questionId, (question) => ({ ...question, state: 'promptPlaying' }));
  }
  questionHeard(sessionId: string, questionId: string) {
    return this.mutateQuestion(sessionId, questionId, (question) => {
      if (question.state !== 'promptPlaying') throw new Error('播放状态已改变');
      return { ...question, heardInQuestion: true, state: 'awaitingAnswer' };
    });
  }
  questionAudioFailed(sessionId: string, questionId: string) {
    return this.mutateQuestion(sessionId, questionId, (question) => ({ ...question, state: 'loading' }));
  }
  checkpointTime(sessionId: string, questionId: string, remainingMs: number) {
    return this.mutateQuestion(sessionId, questionId, (question) => ({
      ...question, remainingMs: question.remainingMs === null ? null : Math.max(0, Math.min(question.remainingMs, remainingMs)),
    }));
  }
  async claimIdlePrompt(sessionId: string, questionId: string, now: number) {
    return this.write(() => this.db.transaction('rw', this.db.sessions, async () => {
      const session = await this.db.sessions.get(sessionId);
      const question = session?.questions[session.currentQuestionIndex];
      if (!session || session.status !== 'active' || !question || question.id !== questionId || question.state !== 'awaitingAnswer' || question.hinted) return false;
      if ((question.idlePromptCount ?? 0) >= 2 || (question.lastIdlePromptAt !== undefined && now - question.lastIdlePromptAt < 20_000)) return false;
      question.idlePromptCount = (question.idlePromptCount ?? 0) + 1; question.lastIdlePromptAt = now;
      await this.db.sessions.put(session); return true;
    }));
  }
  async markSessionNarration(sessionId: string, part: 'intro' | 'outro') {
    await this.write(() => this.db.transaction('rw', this.db.sessions, async () => {
      const session = await this.db.sessions.get(sessionId);
      if (!session) return;
      if (part === 'intro') session.guideIntroPlayed = true; else session.guideOutroPlayed = true;
      await this.db.sessions.put(session);
    }));
  }
  async answer(input: {
    sessionId: string; questionId: string; attemptNo: number; kind: 'select' | 'timeout';
    selectedWordId: string | null; ts: number; remainingMs?: number;
  }) {
    const { sessionId, questionId, attemptNo, kind, selectedWordId, ts } = input;
    return this.write(() => this.db.transaction('rw', [this.db.sessions, this.db.attempts, this.db.rewards, this.db.wordProgress, this.db.guideState], async () => {
      const session = await this.db.sessions.get(sessionId);
      if (!session) throw new Error('找不到本轮记录');
      const id = `${questionId}:${attemptNo}`;
      const previous = await this.db.attempts.get(id);
      if (previous) {
        if (previous.sessionId !== sessionId || previous.kind !== kind || previous.selectedWordId !== selectedWordId) throw new Error('重复提交内容不一致');
        return { session, attempt: previous, duplicate: true };
      }
      if (session.status !== 'active') throw new Error('本轮已结束');
      if (session.activity === 'tapSpell') throw new Error('本轮为拼字母活动');
      const question = session.questions[session.currentQuestionIndex];
      if (!question || question.id !== questionId || question.attemptCount + 1 !== attemptNo) throw new Error('作答已更新，请恢复当前题目');
      if (input.remainingMs !== undefined && question.remainingMs !== null) question.remainingMs = Math.max(0, Math.min(input.remainingMs, question.remainingMs));
      const result = reduceAnswer(question, kind, selectedWordId);
      const attempt: AttemptRecord = {
        id, sessionId, questionId, wordId: question.wordId, contentVersion: session.contentVersion,
        ts, activity: 'listenTap', attemptNo, kind, selectedWordId,
        correct: result.correct, heardInQuestion: question.heardInQuestion, hinted: question.hinted,
      };
      await this.db.attempts.add(attempt);
      const reward = participationReward(attempt);
      if (reward && !await this.db.rewards.get(reward.id)) await this.db.rewards.add(reward);
      session.clockRolledBack ||= ts < session.updatedAt;
      const progress: WordProgress = await this.db.wordProgress.get(question.wordId) ?? { wordId: question.wordId, heardCount: 0 };
      await this.db.wordProgress.put(applyLearningEvidence(progress, attempt, session.clockRolledBack));
      if ((session.contentStage ?? 0) >= 2) await this.addMissingStickers(session.id);
      session.questions[session.currentQuestionIndex] = result.question;
      if (result.question.state === 'completed') {
        session.currentQuestionIndex += 1;
        if (session.currentQuestionIndex === session.questions.length) {
          session.status = 'completed';
          await this.advanceGuideStep('round_end');
        }
      }
      session.updatedAt = ts;
      await this.db.sessions.put(session);
      return { session, attempt, duplicate: false };
    }));
  }
  async abandonSession(id: string, now: number) {
    await this.write(() => this.db.transaction('rw', this.db.sessions, async () => {
      const current = await this.db.sessions.get(id);
      if (current?.status === 'active') await this.db.sessions.put({ ...current, status: 'abandoned', updatedAt: now });
    }));
  }
  async placeSpellingLetter(sessionId: string, questionId: string, tile: number, word: WordEntry) {
    let accepted = false;
    const session = await this.mutateQuestion(sessionId, questionId, (question, session) => {
      if (session.activity !== 'tapSpell' || word.contentVersion !== session.contentVersion || question.wordId !== word.wordId || word.track !== 'phonics') throw new Error('词条已经切换');
      const result = placeSpellingTile(question, word, tile); accepted = result.accepted; return result.question;
    });
    return { session, accepted };
  }
  heardSpellingPart(sessionId: string, questionId: string, part: number, word: WordEntry) {
    return this.mutateQuestion(sessionId, questionId, (question, session) => {
      if (session.activity !== 'tapSpell' || word.contentVersion !== session.contentVersion || question.wordId !== word.wordId || word.track !== 'phonics') throw new Error('词条已经切换');
      return spellingPartHeard(question, word, part);
    });
  }
  showSpellingAnswer(sessionId: string, questionId: string) {
    return this.mutateQuestion(sessionId, questionId, (question) => {
      if (!question.spelling) throw new Error('本题不是拼字母');
      return { ...question, hinted: true, state: 'feedback', spelling: { ...question.spelling, skipped: true, pendingPart: undefined } };
    });
  }
  completeSpelling(sessionId: string, questionId: string, word: WordEntry, now: number) {
    return this.write(() => this.db.transaction('rw', [this.db.sessions, this.db.attempts, this.db.rewards, this.db.wordProgress], async () => {
      const session = await this.db.sessions.get(sessionId);
      if (!session || session.activity !== 'tapSpell' || word.track !== 'phonics') throw new Error('本轮不是拼字母');
      const previous = session.questions.find((question) => question.id === questionId);
      if (previous?.state === 'completed') return session;
      const question = session.questions[session.currentQuestionIndex];
      if (session.status !== 'active' || !question || question.id !== questionId || question.wordId !== word.wordId
        || word.contentVersion !== session.contentVersion || !question.spelling) throw new Error('题目已经切换');
      if (!question.spelling.skipped) {
        if (!spellingReadyToFinish(question, word)) throw new Error('请依次拼好并听完全部声音');
        const attempt: AttemptRecord = { id: `${questionId}:1`, sessionId, questionId, wordId: word.wordId, contentVersion: session.contentVersion,
          ts: now, activity: 'tapSpell', attemptNo: 1, kind: 'select', selectedWordId: word.wordId, correct: true,
          heardInQuestion: question.heardInQuestion, hinted: question.hinted };
        await this.db.attempts.add(attempt);
        const reward = participationReward(attempt); if (reward) await this.db.rewards.add(reward);
        const progress = await this.db.wordProgress.get(word.wordId) ?? { wordId: word.wordId, heardCount: 0 };
        await this.db.wordProgress.put(applyLearningEvidence(progress, attempt));
      }
      question.state = 'completed'; session.currentQuestionIndex += 1; session.updatedAt = now;
      if (session.currentQuestionIndex === session.questions.length) session.status = 'completed';
      await this.db.sessions.put(session); return session;
    }));
  }
  async exportProgress() {
    return this.db.transaction('r', [this.db.wordProgress, this.db.attempts, this.db.rewards], async () => ({
      exportVersion: 1, exportedAt: new Date().toISOString(),
      wordProgress: await this.progress(), attempts: await this.db.attempts.toArray(), rewards: await this.db.rewards.toArray(),
    }));
  }
}
