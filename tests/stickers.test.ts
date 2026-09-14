import { afterEach, describe, expect, it } from 'vitest';
import { LearningDatabase } from '../src/data/database.ts';
import { LearningRepository } from '../src/data/learning-repository.ts';
import { missingStickers } from '../src/domain/stickers.ts';
import type { Reward } from '../src/domain/models.ts';
import { readyIds, settings, theme, words } from './fixtures.ts';

const databases: LearningDatabase[] = [];
afterEach(async () => { for (const db of databases.splice(0)) { db.close(); await db.delete(); } });
async function setup() {
  const db = new LearningDatabase(`stickers-${crypto.randomUUID()}`); databases.push(db);
  const repo = new LearningRepository(db); await repo.initialize(); return { db, repo };
}
describe('sticker milestones', () => {
  it('uses distinct first-correct words, not exploration, hearing or duplicate input rows', () => {
    const progress = words.map((word, index) => ({ wordId: word.wordId, heardCount: 1, exploredAt: 1, ...(index < 5 ? { firstCorrectAt: index * 100 } : {}) }));
    const reward = missingStickers([...progress, progress[0]!], new Set());
    expect(reward).toHaveLength(1); expect(reward[0]).toMatchObject({ id: 'sticker:1', milestone: 1, ts: 400, kind: 'sticker' });
    expect(reward[0]!.sessionId).toBeUndefined();
    expect(missingStickers(progress, new Set(['sticker:1']))).toEqual([]);
    expect(missingStickers(progress.map((entry) => ({ ...entry, firstCorrectAt: undefined })), new Set())).toEqual([]);
  });
  it('backfills existing progress once and retains previously earned stickers', async () => {
    const { db, repo } = await setup();
    await db.wordProgress.bulkPut(words.map((word, index) => ({ wordId: word.wordId, heardCount: 1, firstCorrectAt: index })));
    await Promise.all([repo.reconcileStickers(), repo.reconcileStickers()]);
    expect((await repo.stickers()).map((reward) => reward.id)).toEqual(['sticker:1', 'sticker:2']);
    await db.wordProgress.delete(words[0]!.wordId);
    expect(await repo.reconcileStickers()).toEqual([]); expect(await repo.stickers()).toHaveLength(2);
  });
  it('commits the fifth answer and its sticker atomically, including rollback and duplicate callbacks', async () => {
    const { db, repo } = await setup();
    const session = (await repo.startSession({ id: 'milestone', now: 100, words, theme, readyIds, settings, random: () => .4, contentStage: 2 }))!;
    for (let index = 0; index < 4; index++) {
      const question = session.questions[index]!;
      await repo.prepareQuestion(session.id, question.id); await repo.questionHeard(session.id, question.id);
      await repo.answer({ sessionId: session.id, questionId: question.id, attemptNo: 1, kind: 'select', selectedWordId: question.wordId, ts: 200 + index });
    }
    const fifth = session.questions[4]!;
    await repo.prepareQuestion(session.id, fifth.id); await repo.questionHeard(session.id, fifth.id);
    const failSticker = (_key: unknown, record: Reward) => { if (record.kind === 'sticker') throw new Error('Sticker write failed'); };
    db.rewards.hook('creating', failSticker);
    const input = { sessionId: session.id, questionId: fifth.id, attemptNo: 1, kind: 'select' as const, selectedWordId: fifth.wordId, ts: 204 };
    await expect(repo.answer(input)).rejects.toThrow('Sticker write failed');
    expect(await db.attempts.count()).toBe(4); expect(await db.rewards.count()).toBe(4);
    expect((await repo.activeSession())!.currentQuestionIndex).toBe(4);
    expect((await repo.progress()).filter((entry) => entry.firstCorrectAt !== undefined)).toHaveLength(4);
    db.rewards.hook('creating').unsubscribe(failSticker);
    await Promise.all([repo.answer(input), repo.answer(input)]);
    expect(await repo.stickers()).toHaveLength(1);
    expect((await repo.rewards(session.id)).filter((reward) => reward.kind === 'participation')).toHaveLength(5);
    expect((await repo.stickers())[0]).toMatchObject({ id: 'sticker:1', sessionId: session.id, wordId: fifth.wordId, ts: 204 });
  });
});
