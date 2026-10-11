import { describe, expect, it } from 'vitest';
import { Sm2Engine, availableWords, buildSession, masteryStats, type CardState, type SessionProgress, type SrsWord } from '../src/core/srs/index.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function makeCard(overrides?: Partial<CardState>): CardState {
  return { wordId: 'w_tb4a_001', repetitions: 0, ease: 2.5, interval: 0, due: NOW, lastReviewed: null, reviewCount: 0, lapses: 0, learned: false, ...overrides };
}
const word = (id: string, core = true, unit = 2): SrsWord => ({ id, core, unit });
const learning = (id: string, overrides?: Partial<SessionProgress>): [string, SessionProgress] => [id, { learned: true, due: NOW, interval: 1, ...overrides }];

describe('Sm2Engine', () => {
  const engine = new Sm2Engine();

  it('creates a fresh, immediately due card with default ease', () => {
    const card = engine.init('w_tb4a_001');
    expect(card).toMatchObject({ wordId: 'w_tb4a_001', repetitions: 0, ease: 2.5, interval: 0, learned: false, lapses: 0 });
    expect(card.due).toBeLessThanOrEqual(Date.now());
  });

  it('resets repetitions, counts a lapse and retries after ten minutes on "again"', () => {
    const card = makeCard({ learned: true, repetitions: 3, interval: 7 });
    const { next, wasCorrect } = engine.review(card, 'again', NOW);
    expect(wasCorrect).toBe(false);
    expect(next).toMatchObject({ repetitions: 0, interval: 0, lapses: 1, learned: true, reviewCount: 1 });
    expect(next.due).toBe(NOW + 10 * 60 * 1000);
  });

  it('lowers ease on "again" but never below the floor', () => {
    expect(engine.review(makeCard({ ease: 2.5 }), 'again', NOW).next.ease).toBeCloseTo(2.3, 1);
    expect(engine.review(makeCard({ ease: 1.3 }), 'again', NOW).next.ease).toBe(1.3);
  });

  it('uses 1 day, then 3 days, then the ease factor for later intervals', () => {
    const first = engine.review(makeCard(), 'good', NOW);
    expect(first.next).toMatchObject({ repetitions: 1, interval: 1 });
    expect(first.next.due).toBe(NOW + DAY);

    const second = engine.review(first.next, 'good', NOW + DAY);
    expect(second.next).toMatchObject({ repetitions: 2, interval: 3 });

    // q=4 时易度不变（2.5），第三轮间隔 = round(3 * 2.5) = 8
    const third = engine.review(second.next, 'good', NOW + 4 * DAY);
    expect(third.next.interval).toBe(8);
    expect(third.next.due).toBe(NOW + 4 * DAY + 8 * DAY);
  });

  it('raises ease on "easy" and converges the interval on "hard"', () => {
    const base = makeCard({ repetitions: 2, interval: 3, ease: 2.5, learned: true });
    expect(engine.review(base, 'easy', NOW).next.ease).toBeCloseTo(2.6, 1);
    // round(3 * 2.5 * 0.7) = 5；首答 hard 时 round(1 * 0.7) 被下限抬回 1
    expect(engine.review(base, 'hard', NOW).next.interval).toBe(5);
    expect(engine.review(makeCard({ repetitions: 1, interval: 1 }), 'hard', NOW).next.interval).toBe(2);
    expect(engine.review(makeCard(), 'hard', NOW).next.interval).toBe(1);
  });

  it('never mutates the card it is given and always increments reviewCount', () => {
    const original = makeCard({ repetitions: 5 });
    const frozen = { ...original };
    const first = engine.review(original, 'good', NOW);
    expect(original).toEqual(frozen);
    expect(first.next.reviewCount).toBe(1);
    expect(engine.review(first.next, 'again', NOW + DAY).next.reviewCount).toBe(2);
  });

  it('honours custom ease, retry and interval options', () => {
    const custom = new Sm2Engine({ minEase: 1.5, initialEase: 2.8, retryMinutes: 5, intervalAfterFirst: 2, intervalAfterSecond: 6 });
    const card = custom.init('w_tb4a_002');
    expect(card.ease).toBe(2.8);
    expect(custom.review(card, 'again', NOW).next.due).toBe(NOW + 5 * 60 * 1000);
    const first = custom.review(card, 'good', NOW);
    expect(first.next.interval).toBe(2);
    expect(custom.review(first.next, 'good', NOW + 2 * DAY).next.interval).toBe(6);
  });
});

describe('buildSession', () => {
  const words = [word('w_tb4a_001'), word('w_tb4a_002'), word('w_tb4a_003', false), word('w_tb4a_101', true, 3)];

  it('filters non-core words unless the profile opts in', () => {
    expect(availableWords(words, false).map((entry) => entry.id)).toEqual(['w_tb4a_001', 'w_tb4a_002', 'w_tb4a_101']);
    expect(availableWords(words, true)).toHaveLength(4);
  });

  it('returns only the requested words for a mistake-book round', () => {
    const plan = buildSession({ words, progress: new Map(), dailyNewTarget: 10, includeNonCore: true, wordIds: ['w_tb4a_003'], now: NOW });
    expect(plan).toEqual({ dueReviews: [word('w_tb4a_003', false)], newWords: [], all: [word('w_tb4a_003', false)] });
  });

  it('puts due reviews first in due order and then the daily quota of new words', () => {
    const progress = new Map<string, SessionProgress>([learning('w_tb4a_001', { due: NOW - 2 * DAY }), learning('w_tb4a_002', { due: NOW - 5 * DAY }), learning('w_tb4a_101', { due: NOW + DAY })]);
    const plan = buildSession({ words, progress, dailyNewTarget: 1, includeNonCore: false, now: NOW });
    expect(plan.dueReviews.map((entry) => entry.id)).toEqual(['w_tb4a_002', 'w_tb4a_001']);
    expect(plan.newWords).toHaveLength(0);
    expect(plan.all.map((entry) => entry.id)).toEqual(['w_tb4a_002', 'w_tb4a_001']);
  });

  it('takes new words in textbook order up to the daily target', () => {
    const plan = buildSession({ words, progress: new Map(), dailyNewTarget: 2, includeNonCore: false, now: NOW });
    expect(plan.newWords.map((entry) => entry.id)).toEqual(['w_tb4a_001', 'w_tb4a_002']);
  });

  it('ignores the daily target for a unit round and falls back to the whole unit when everything is learned', () => {
    const unitTwoIds = ['w_tb4a_001', 'w_tb4a_002', 'w_tb4a_003'];
    const fresh = buildSession({ words, progress: new Map(), dailyNewTarget: 1, includeNonCore: true, unit: 2, now: NOW });
    expect(fresh.newWords.map((entry) => entry.id)).toEqual(unitTwoIds);

    const learned = new Map<string, SessionProgress>(unitTwoIds.map((id) => learning(id, { due: NOW + 5 * DAY })));
    const reinforcement = buildSession({ words, progress: learned, dailyNewTarget: 1, includeNonCore: true, unit: 2, now: NOW });
    expect(reinforcement.newWords).toHaveLength(0);
    expect(reinforcement.dueReviews.map((entry) => entry.id)).toEqual(unitTwoIds);
    expect(reinforcement.all).toHaveLength(3);
  });

  it('reports mastery, learned and due counts for the available pool', () => {
    const progress = new Map<string, SessionProgress>([learning('w_tb4a_001', { interval: 8 }), learning('w_tb4a_002', { interval: 3, due: NOW + DAY })]);
    expect(masteryStats({ words, progress, includeNonCore: false, now: NOW })).toEqual({ total: 3, learned: 2, mastered: 1, dueNow: 1 });
    expect(masteryStats({ words, progress, includeNonCore: true, now: NOW })).toEqual({ total: 4, learned: 2, mastered: 1, dueNow: 1 });
  });
});
