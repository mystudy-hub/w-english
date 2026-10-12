import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearningDatabase } from '../src/data/database.ts';
import { DrillRepository, localDay } from '../src/data/drill-repository.ts';
import { DEFAULT_PROFILE_ID, defaultProfile } from '../src/domain/profiles.ts';
import type { SrsWord } from '../src/core/srs/index.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const word = (id: string, unit = 2): SrsWord => ({ id, core: true, unit });

let db: LearningDatabase; let drill: DrillRepository;
beforeEach(async () => {
  db = new LearningDatabase(`drill-${crypto.randomUUID()}`); drill = new DrillRepository(db);
  await db.open(); await drill.saveProfile(defaultProfile());
});
afterEach(async () => { await db.delete(); });

describe('drill progress', () => {
  it('starts a new word on the first correct answer and counts it once', async () => {
    const outcome = await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW });
    expect(outcome.repeated).toBe(false);
    expect(outcome.wasCorrect).toBe(true);
    expect(outcome.card).toMatchObject({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', repetitions: 1, interval: 1, learned: true, lapses: 0 });
    expect(outcome.card.due).toBe(NOW + DAY);

    const log = await drill.dailyLog(DEFAULT_PROFILE_ID, localDay(NOW));
    expect(log).toMatchObject({ newLearned: 1, reviews: 1, correct: 1 });
  });

  it('keeps a wrong answer for ten minutes and records a lapse without a correct count', async () => {
    const outcome = await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_002', grade: 'again', now: NOW });
    expect(outcome.wasCorrect).toBe(false);
    expect(outcome.card).toMatchObject({ repetitions: 0, interval: 0, lapses: 1, learned: true });
    expect(outcome.card.due).toBe(NOW + 10 * 60 * 1000);
    expect(await drill.dailyLog(DEFAULT_PROFILE_ID, localDay(NOW))).toMatchObject({ newLearned: 1, reviews: 1, correct: 0 });
  });

  it('counts a word as new only once, then only adds reviews', async () => {
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW });
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW + DAY });
    const log = await drill.dailyLog(DEFAULT_PROFILE_ID, localDay(NOW + DAY));
    expect(log).toMatchObject({ newLearned: 0, reviews: 1, correct: 1 });
    expect(await drill.dailyLogs(DEFAULT_PROFILE_ID)).toHaveLength(2);
  });

  it('ignores a repeated submission of the same millisecond', async () => {
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW });
    const again = await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW });
    expect(again.repeated).toBe(true);
    expect(await drill.dailyLog(DEFAULT_PROFILE_ID, localDay(NOW))).toMatchObject({ newLearned: 1, reviews: 1, correct: 1 });
    expect(await drill.progress(DEFAULT_PROFILE_ID)).toHaveLength(1);
  });

  it('keeps two profiles apart', async () => {
    await drill.saveProfile({ ...defaultProfile('p_second', '哥哥'), dailyNewTarget: 20 });
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW });
    await drill.review({ profileId: 'p_second', wordId: 'w_tb4a_001', grade: 'again', now: NOW });

    const [me, brother] = await Promise.all([drill.progress(DEFAULT_PROFILE_ID), drill.progress('p_second')]);
    expect(me[0]).toMatchObject({ repetitions: 1, interval: 1 });
    expect(brother[0]).toMatchObject({ repetitions: 0, lapses: 1 });
    expect(await drill.dailyLog('p_second', localDay(NOW))).toMatchObject({ correct: 0 });
    expect((await drill.profile('p_second'))?.dailyNewTarget).toBe(20);
  });

  it('awards coins and extends the streak once per day', async () => {
    const first = await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'easy', now: NOW });
    expect(first.coins).toBe(3);
    expect(await drill.profile(DEFAULT_PROFILE_ID)).toMatchObject({ coins: 3, totalReviews: 1, streak: 1, lastStudyDay: localDay(NOW) });

    // 同一天再答对：金币累加，连击不变
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_002', grade: 'good', now: NOW + 3600_000 });
    expect(await drill.profile(DEFAULT_PROFILE_ID)).toMatchObject({ coins: 5, totalReviews: 2, streak: 1, lastStudyDay: localDay(NOW) });

    // 第二天：连击 +1
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_003', grade: 'good', now: NOW + DAY });
    expect(await drill.profile(DEFAULT_PROFILE_ID)).toMatchObject({ coins: 7, totalReviews: 3, streak: 2, lastStudyDay: localDay(NOW + DAY) });
  });

  it('a wrong answer earns nothing and a retried one earns a single coin', async () => {
    const wrong = await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'again', now: NOW });
    expect(wrong.coins).toBe(0);
    const retried = await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', retried: true, now: NOW + 600_000 });
    expect(retried.coins).toBe(1);
    expect(await drill.profile(DEFAULT_PROFILE_ID)).toMatchObject({ coins: 1, totalReviews: 2 });
  });

  it('lists due cards in due order and only up to now', async () => {
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW - 3 * DAY });
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_002', grade: 'good', now: NOW - 2 * DAY });
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_003', grade: 'good', now: NOW + 5 * DAY });
    const due = await drill.due(DEFAULT_PROFILE_ID, NOW);
    expect(due.map((card) => card.wordId)).toEqual(['w_tb4a_001', 'w_tb4a_002']);
  });
});

describe('drill planning', () => {
  const words = [word('w_tb4a_001'), word('w_tb4a_002'), word('w_tb4a_003')];

  it('puts due reviews before new words and respects the daily target', async () => {
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW - 3 * DAY });
    const plan = await drill.plan({ profileId: DEFAULT_PROFILE_ID, words, dailyNewTarget: 1, includeNonCore: false, now: NOW });
    expect(plan.all.map((entry) => entry.id)).toEqual(['w_tb4a_001', 'w_tb4a_002']);
  });

  it("caps the day's new words at the target when a whole unit is handed in", async () => {
    const unit = [word('w_tb4a_001'), word('w_tb4a_002'), word('w_tb4a_003')];
    const plan = await drill.plan({ profileId: DEFAULT_PROFILE_ID, words: unit, dailyNewTarget: 2, includeNonCore: false, now: NOW });
    expect(plan.newWords.map((entry) => entry.id)).toEqual(['w_tb4a_001', 'w_tb4a_002']);
    expect(plan.all).toHaveLength(2);
  });

  it('hands a mistake-book round straight to the requested words', async () => {
    const plan = await drill.plan({ profileId: DEFAULT_PROFILE_ID, words, dailyNewTarget: 10, includeNonCore: false, wordIds: ['w_tb4a_003'], now: NOW });
    expect(plan).toEqual({ dueReviews: [word('w_tb4a_003')], newWords: [], all: [word('w_tb4a_003')] });
  });

  it('reports learned, mastered and due counts for the profile', async () => {
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'good', now: NOW - 3 * DAY });
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'easy', now: NOW - 2 * DAY });
    await drill.review({ profileId: DEFAULT_PROFILE_ID, wordId: 'w_tb4a_001', grade: 'easy', now: NOW - DAY });
    expect(await drill.mastery({ profileId: DEFAULT_PROFILE_ID, words, includeNonCore: false, now: NOW }))
      .toEqual({ total: 3, learned: 1, mastered: 1, dueNow: 0 });
  });
});
