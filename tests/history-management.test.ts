import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningDatabase } from '../src/data/database.ts';
import { LearningRepository } from '../src/data/learning-repository.ts';
import { configSnapshot, defaultGuide, defaultSettings } from '../src/domain/config.ts';
import type { SessionSnapshot } from '../src/domain/models.ts';
import { attempt, question } from './fixtures.ts';

const DAY = 86_400_000; const NOW = 200 * DAY;
let db: LearningDatabase; let repository: LearningRepository;
beforeEach(async () => { db = new LearningDatabase(`history-${crypto.randomUUID()}`); repository = new LearningRepository(db); await repository.initialize(); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
async function addRound(id: string, ts: number, status: SessionSnapshot['status'] = 'completed', activity: SessionSnapshot['activity'] = 'listenTap') {
  const q = question({ id: `${id}:q1`, state: status === 'completed' ? 'completed' : 'awaitingAnswer', attemptCount: 1 });
  const session: SessionSnapshot = { id, status, activity, configSnapshot: configSnapshot('tap', 'L1'), themeId: 'animal_home',
    contentVersion: '2026.09.3', questions: [q], questionIds: [q.id], currentQuestionIndex: status === 'completed' ? 1 : 0,
    startedAt: ts, updatedAt: ts, clockRolledBack: false };
  await db.sessions.put(session);
  await db.attempts.put(attempt({ id: `${q.id}:1`, questionId: q.id, sessionId: id, ts, activity }));
  await db.rewards.put({ id: `${q.id}:participation`, wordId: q.wordId, sessionId: id, ts, kind: 'participation' });
}

describe('ninety-day history retention', () => {
  it('keeps current work, recent records, twenty ended listening questions, aggregates and all stickers', async () => {
    for (let index = 1; index <= 24; index++) await addRound(`round-${index}`, index * DAY);
    await addRound('current', DAY, 'active'); await addRound('unfinished', 50 * DAY, 'abandoned');
    await addRound('old-spelling', 60 * DAY, 'completed', 'tapSpell');
    await addRound('recent', NOW - DAY, 'completed', 'tapSpell');
    await addRound('boundary', NOW - 90 * DAY, 'completed', 'tapSpell');
    const progress = { wordId: 'w_cat_001', heardCount: 9, exploredAt: DAY, firstCorrectAt: 2 * DAY, reviewCorrectAt: 4 * DAY };
    await db.wordProgress.put(progress);
    const sticker = { id: 'sticker:1', kind: 'sticker' as const, milestone: 5, wordId: 'w_cat_001', sessionId: 'round-1', ts: DAY };
    await db.rewards.put(sticker);
    expect(await repository.retainRecentHistory(NOW)).toEqual({ sessions: 6, attempts: 6, participationStars: 6 });
    const remaining = new Set((await db.sessions.toArray()).map((session) => session.id));
    expect(remaining).toEqual(new Set(['current', 'recent', 'boundary', ...Array.from({ length: 20 }, (_, index) => `round-${index + 5}`)]));
    expect(await repository.progress()).toEqual([progress]); expect(await repository.stickers()).toEqual([sticker]);
    expect(await repository.retainRecentHistory(NOW)).toEqual({ sessions: 0, attempts: 0, participationStars: 0 });
  });
  it('preserves an old snapshot with a recent attempt and is conservative when the clock moves backward', async () => {
    await addRound('kept', DAY, 'abandoned'); await addRound('prunable', 2 * DAY, 'abandoned');
    await db.attempts.update('kept:q1:1', { ts: NOW });
    expect(await repository.retainRecentHistory(20 * DAY)).toEqual({ sessions: 0, attempts: 0, participationStars: 0 });
    await repository.retainRecentHistory(NOW);
    expect((await db.sessions.toArray()).map((session) => session.id)).toEqual(['kept']);
    expect(await db.attempts.count()).toBe(1);
  });
  it('rolls back all deletions if removing session snapshots fails', async () => {
    await addRound('old', DAY, 'abandoned');
    vi.spyOn(db.sessions, 'bulkDelete').mockRejectedValueOnce(new Error('Interrupted cleanup'));
    await expect(repository.retainRecentHistory(NOW)).rejects.toThrow('Interrupted cleanup');
    expect(await db.sessions.count()).toBe(1); expect(await db.attempts.count()).toBe(1); expect(await db.rewards.count()).toBe(1);
  });
});

describe('explicit parent record clearing', () => {
  it('clears the complete learning history atomically while preserving settings and the rest state', async () => {
    await addRound('active', DAY, 'active'); await repository.discover('w_cat_001', DAY);
    await db.rewards.put({ id: 'sticker:1', kind: 'sticker', milestone: 5, wordId: 'w_cat_001', ts: DAY });
    const settings = defaultSettings(); settings.parentSettings.screenTimeMinutes = 18; settings.interactionMode = 'drag';
    await repository.saveSettings(settings);
    await repository.checkpointUsage({ cycle: 0, writerId: 'test', sequence: 1, cumulativeMs: 18 * 60_000, now: NOW, limitMinutes: 18 });
    await repository.changeUsage('show', 0, NOW);
    const usage = await repository.usage();
    await repository.clearLearningRecords();
    expect(await db.sessions.count()).toBe(0); expect(await db.attempts.count()).toBe(0);
    expect(await db.rewards.count()).toBe(0); expect(await repository.progress()).toEqual([]);
    expect(await db.guideState.get('local')).toEqual(defaultGuide());
    expect(await repository.settings()).toEqual(settings); expect(await repository.usage()).toEqual(usage);
  });
  it('restores every learning table if any clear operation fails', async () => {
    await addRound('active', DAY, 'active'); await repository.discover('w_cat_001', DAY);
    const before = await repository.exportProgress(); const guide = await db.guideState.get('local');
    vi.spyOn(db.guideState, 'put').mockRejectedValueOnce(new Error('Guide write failed'));
    await expect(repository.clearLearningRecords()).rejects.toThrow('Guide write failed');
    const after = await repository.exportProgress();
    expect(after.wordProgress).toEqual(before.wordProgress); expect(after.rewards).toEqual(before.rewards); expect(after.attempts).toEqual(before.attempts);
    expect(await db.sessions.count()).toBe(1); expect(await db.guideState.get('local')).toEqual(guide);
  });
});
