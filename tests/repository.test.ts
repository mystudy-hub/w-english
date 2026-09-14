import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningDatabase } from '../src/data/database.ts';
import { LearningRepository } from '../src/data/learning-repository.ts';
import { readyIds, settings, theme, words } from './fixtures.ts';

let db: LearningDatabase;
let repository: LearningRepository;
beforeEach(async () => { db = new LearningDatabase(`test-${crypto.randomUUID()}`); repository = new LearningRepository(db); await repository.initialize(); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
async function start() {
  const session = (await repository.startSession({ id: crypto.randomUUID(), now: 1000, theme, words, readyIds, settings, random: () => 0.25 }))!;
  const question = session.questions[0]!;
  await repository.prepareQuestion(session.id, question.id);
  await repository.questionHeard(session.id, question.id);
  return { session, question, input: { sessionId: session.id, questionId: question.id, attemptNo: 1, kind: 'select' as const, selectedWordId: question.wordId, ts: 2000 } };
}

describe('IndexedDB transactions and recovery', () => {
  it('commits concurrent duplicate clicks once and returns the original result', async () => {
    const { input, session } = await start();
    const results = await Promise.all([repository.answer(input), repository.answer(input)]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.rewards.count()).toBe(1);
    expect((await repository.session(session.id))?.currentQuestionIndex).toBe(1);
    expect((await repository.progress()).filter((entry) => entry.firstCorrectAt !== undefined)).toHaveLength(1);
  });
  it('rolls back attempt, reward, progress and question when a write fails', async () => {
    const { input, session } = await start();
    const failure = vi.spyOn(db.rewards, 'add').mockRejectedValueOnce(new Error('Simulated quota'));
    await expect(repository.answer(input)).rejects.toThrow('Simulated quota');
    expect(await db.attempts.count()).toBe(0);
    expect(await db.rewards.count()).toBe(0);
    expect(await db.wordProgress.count()).toBe(0);
    expect((await repository.session(session.id))?.questions[0]?.attemptCount).toBe(0);
    failure.mockRestore();
    await repository.answer(input);
    expect(await db.attempts.count()).toBe(1);
  });
  it('retries earn only one star and never become first-choice evidence', async () => {
    const { input, question, session } = await start();
    await repository.answer({ ...input, selectedWordId: question.optionIds.find((id) => id !== question.wordId)! });
    await repository.prepareQuestion(session.id, question.id);
    await repository.questionHeard(session.id, question.id);
    await repository.answer({ ...input, attemptNo: 2, ts: 3000 });
    expect(await db.rewards.count()).toBe(1);
    expect(await db.attempts.count()).toBe(2);
    expect((await db.wordProgress.get(question.wordId))?.firstCorrectAt).toBeUndefined();
  });
  it('preserves exact question identity and options across a new repository instance', async () => {
    const { session } = await start();
    const before = await repository.activeSession();
    const reopened = new LearningRepository(db);
    await reopened.initialize();
    expect(await reopened.activeSession()).toEqual(before);
    expect((await reopened.activeSession())?.id).toBe(session.id);
  });
  it('deduplicates concurrent audio-completion callbacks, but counts genuine replays', async () => {
    const id = words[0]!.wordId;
    await Promise.all([repository.heard(id, 'play-1'), repository.heard(id, 'play-1')]);
    expect((await db.wordProgress.get(id))?.heardCount).toBe(1);
    await repository.heard(id, 'play-2');
    expect((await db.wordProgress.get(id))?.heardCount).toBe(2);
  });
  it('keeps config snapshots unchanged after parent edits', async () => {
    const { session } = await start();
    await repository.saveSettings({ ...settings, learningLevel: 'L3', interactionMode: 'drag' });
    expect((await repository.session(session.id))?.configSnapshot).toMatchObject({ learningLevel: 'L1', optionCount: 3, timeLimitMs: null });
  });
  it('rejects stale or conflicting submissions without modifying other questions', async () => {
    const { input } = await start();
    await repository.answer(input);
    await expect(repository.answer({ ...input, selectedWordId: words.find((word) => word.wordId !== input.selectedWordId)!.wordId })).rejects.toThrow('不一致');
    expect(await db.attempts.count()).toBe(1);
  });
  it('claims idle prompts transactionally and preserves their cap across repository instances', async () => {
    const { session, question } = await start();
    const claims = await Promise.all([repository.claimIdlePrompt(session.id, question.id, 9000), repository.claimIdlePrompt(session.id, question.id, 9000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await repository.claimIdlePrompt(session.id, question.id, 28999)).toBe(false);
    const reopened = new LearningRepository(db);
    expect(await reopened.claimIdlePrompt(session.id, question.id, 29000)).toBe(true);
    expect(await reopened.claimIdlePrompt(session.id, question.id, 60000)).toBe(false);
  });
});
