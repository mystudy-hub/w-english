import { afterEach, describe, expect, it } from 'vitest';
import { wordSchema, type WordEntry } from '../src/data/content-schema.ts';
import { configSnapshot, defaultSettings } from '../src/domain/config.ts';
import { createSpellingSession, graphemeKind, placeSpellingTile, spellingPartHeard, spellingReadyToFinish } from '../src/domain/spelling.ts';
import { applyLearningEvidence, REVIEW_DELAY_MS } from '../src/domain/learning.ts';
import { LearningDatabase } from '../src/data/database.ts';
import { LearningRepository } from '../src/data/learning-repository.ts';
import type { Question } from '../src/domain/models.ts';
import { theme, words } from './fixtures.ts';

// Structural fixtures only; these are never published as teaching entries.
function sample(word: string, stage: number, graphemes: WordEntry['graphemes']) {
  return wordSchema.parse({ ...words[0], word, wordId: `w_${word}_099`, phonicsStage: stage, spelling: [...word], syllables: [word],
    graphemes, phonemes: graphemes.flatMap((part) => part.phonemes) });
}
const bell = sample('bell', 2, [{ letters: 'b', phonemes: ['b'], audio: 'phonics#b' }, { letters: 'e', phonemes: ['ɛ'], audio: 'phonics#e_short' }, { letters: 'll', phonemes: ['l'], audio: 'phonics#l' }]);
const cake = sample('cake', 3, [{ letters: 'c', phonemes: ['k'], audio: 'phonics#k' }, { letters: 'a', phonemes: ['eɪ'], audio: 'phonics#a_long' }, { letters: 'k', phonemes: ['k'], audio: 'phonics#k' }, { letters: 'e', phonemes: [], audio: null }]);
function question(word: WordEntry): Question {
  return { id: 'q', wordId: word.wordId, optionIds: [], state: 'awaitingAnswer', attemptCount: 0, hinted: false, heardInQuestion: true, remainingMs: null,
    spelling: { tiles: word.spelling.map((_, index) => index), placed: [], heardParts: [], skipped: false } };
}

describe('spelling rules', () => {
  it('filters by phonics track, level and readiness, preserves mode, and has no answer timer', () => {
    const sightInput: Record<string, unknown> = { ...words[0], wordId: 'w_cat_098', track: 'sight' }; delete sightInput.phonicsStage;
    const sight = wordSchema.parse(sightInput); const pool = [words[0]!, bell, cake, sight];
    const input = { id: 'spell', now: 100, theme: { ...theme, wordIds: pool.map((word) => word.wordId) }, words: pool, progress: [],
      readyIds: new Set(pool.map((word) => word.wordId)), random: () => 0, config: configSnapshot('tap', 'L1') };
    const tap = createSpellingSession(input)!;
    expect(tap.questions.map((entry) => entry.wordId)).toEqual([words[0]!.wordId]);
    expect(tap.questions[0]!.spelling!.tiles).toEqual([0, 1, 2]);
    const drag = createSpellingSession({ ...input, config: configSnapshot('drag', 'L3'), focusWordId: bell.wordId })!;
    expect(drag.configSnapshot.interactionMode).toBe('drag'); expect(drag.configSnapshot.timeLimitMs).toBeNull();
    expect(drag.questions[0]!.spelling!.tiles).not.toEqual([0, 1, 2, 3]);
    expect(createSpellingSession({ ...input, readyIds: new Set() })).toBeNull();
  });
  it('accepts either identical letter tile and plays a doubled consonant only when the group is complete', () => {
    let current = question(bell);
    current = placeSpellingTile(current, bell, 0).question;
    expect(() => placeSpellingTile(current, bell, 1)).toThrow('听完');
    current = spellingPartHeard(current, bell, 0);
    current = spellingPartHeard(placeSpellingTile(current, bell, 1).question, bell, 1);
    current = placeSpellingTile(current, bell, 3).question;
    expect(current.spelling!.pendingPart).toBeUndefined();
    expect(placeSpellingTile(current, bell, 3).accepted).toBe(false);
    current = placeSpellingTile(current, bell, 2).question;
    expect(current.spelling!.pendingPart).toBe(2); expect(spellingReadyToFinish(current, bell)).toBe(false);
    current = spellingPartHeard(current, bell, 2);
    expect(current.spelling!.heardParts).toEqual([0, 1, 2]); expect(spellingReadyToFinish(current, bell)).toBe(true);
  });
  it('does not advance on a wrong tile or require sound for silent e', () => {
    let current = question(cake);
    expect(placeSpellingTile(current, cake, 1).accepted).toBe(false);
    for (const tile of [0, 1, 2, 3]) {
      current = placeSpellingTile(current, cake, tile).question;
      if (current.spelling!.pendingPart !== undefined) current = spellingPartHeard(current, cake, current.spelling!.pendingPart);
    }
    expect(current.spelling!.heardParts).toEqual([0, 1, 2]); expect(spellingReadyToFinish(current, cake)).toBe(true);
    expect(graphemeKind(cake.graphemes[3]!)).toBe('silent');
    expect(graphemeKind({ letters: 'y', phonemes: ['i'], audio: 'phonics#ee' })).toBe('vowel');
  });
  it('keeps spelling completion separate from vocabulary mastery and 24-hour review evidence', () => {
    const next = applyLearningEvidence({ wordId: bell.wordId, heardCount: 1, firstCorrectAt: 0 }, {
      id: 'q:1', sessionId: 's', questionId: 'q', wordId: bell.wordId, contentVersion: bell.contentVersion,
      ts: REVIEW_DELAY_MS, activity: 'tapSpell', attemptNo: 1, kind: 'select', selectedWordId: bell.wordId,
      heardInQuestion: true, correct: true, hinted: false,
    });
    expect(next.firstCorrectAt).toBe(0); expect(next.reviewCorrectAt).toBeUndefined();
  });
});

const databases: LearningDatabase[] = [];
afterEach(async () => { for (const db of databases.splice(0)) { db.close(); await db.delete(); } });
async function started() {
  const db = new LearningDatabase(`spelling-${crypto.randomUUID()}`); databases.push(db); const repo = new LearningRepository(db);
  await repo.initialize();
  const settings = { ...defaultSettings(), learningLevel: 'L2' as const };
  const session = (await repo.startSession({ id: 'spell', now: 100, theme: { ...theme, wordIds: [bell.wordId] }, words: [bell], settings,
    readyIds: new Set([bell.wordId]), random: () => 0, activity: 'tapSpell' }))!;
  const id = session.questions[0]!.id;
  await repo.prepareQuestion(session.id, id); await repo.questionHeard(session.id, id); await repo.heard(bell.wordId, 'natural-word-end');
  return { db, repo, session, id };
}
describe('durable spelling sessions', () => {
  it('resumes a pending sound without marking it heard or granting a star', async () => {
    const { db, repo, session, id } = await started(); await repo.placeSpellingLetter(session.id, id, 0, bell);
    const resumed = new LearningRepository(db); const saved = (await resumed.activeSession())!;
    expect(saved.questions[0]!.spelling).toMatchObject({ placed: [0], pendingPart: 0, heardParts: [] });
    await expect(resumed.completeSpelling(session.id, id, bell, 200)).rejects.toThrow('听完');
    expect(await resumed.rewards()).toEqual([]);
    await expect(resumed.placeSpellingLetter(session.id, id, 1, { ...bell, contentVersion: '2026.10.1' })).rejects.toThrow('词条已经切换');
  });
  it('atomically completes once, rolls back failed rewards and never records first-correct vocabulary', async () => {
    const { db, repo, session, id } = await started();
    for (const tile of [0, 1, 3, 2]) {
      const result = await repo.placeSpellingLetter(session.id, id, tile, bell);
      const part = result.session.questions[0]!.spelling!.pendingPart;
      if (part !== undefined) await repo.heardSpellingPart(session.id, id, part, bell);
    }
    const fail = () => { throw new Error('Reward write failed'); }; db.rewards.hook('creating', fail);
    await expect(repo.completeSpelling(session.id, id, bell, 200)).rejects.toThrow('Reward write failed');
    expect(await db.attempts.count()).toBe(0); expect((await repo.activeSession())!.currentQuestionIndex).toBe(0);
    db.rewards.hook('creating').unsubscribe(fail);
    await Promise.all([repo.completeSpelling(session.id, id, bell, 200), repo.completeSpelling(session.id, id, bell, 200)]);
    expect(await db.attempts.count()).toBe(1); expect(await db.rewards.count()).toBe(1);
    expect(await repo.activeSession()).toBeUndefined(); expect((await repo.progress())[0]!.firstCorrectAt).toBeUndefined();
  });
  it('preserves skipped-answer state but gives neither an attempt nor a participation star', async () => {
    const { db, repo, session, id } = await started();
    await repo.showSpellingAnswer(session.id, id);
    expect((await repo.activeSession())!.questions[0]!.spelling!.skipped).toBe(true);
    await repo.completeSpelling(session.id, id, bell, 200);
    expect(await db.attempts.count()).toBe(0); expect(await db.rewards.count()).toBe(0);
  });
});
