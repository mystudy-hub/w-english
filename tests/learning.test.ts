import { describe, expect, it } from 'vitest';
import { ActiveTimer } from '../src/domain/active-timer.ts';
import { configSnapshot, guideEnabled, reducedMotion } from '../src/domain/config.ts';
import { applyLearningEvidence, isReviewDue, participationReward, reduceAnswer, REVIEW_DELAY_MS } from '../src/domain/learning.ts';
import { chooseOptions, createSession } from '../src/domain/questions.ts';
import { attempt, question, readyIds, settings, theme, words } from './fixtures.ts';

describe('six independent configurations', () => {
  for (const mode of ['tap', 'drag'] as const) for (const level of ['L1', 'L2', 'L3'] as const) {
    it(`${mode}/${level} uses level-driven choices and timing`, () => {
      const config = configSnapshot(mode, level);
      expect(config.optionCount).toBe(level === 'L1' ? 3 : 4);
      expect(config.timeLimitMs).toBe(level === 'L3' ? 15000 : null);
    });
  }
  it('keeps explicit parental overrides and system reduced motion', () => {
    expect(guideEnabled({ ...settings, interactionMode: 'drag' })).toBe(false);
    expect(guideEnabled({ ...settings, interactionMode: 'drag', parentSettings: { ...settings.parentSettings, guideEnabled: true } })).toBe(true);
    expect(reducedMotion(settings, true)).toBe(true);
  });
});

describe('learning evidence and participation', () => {
  it('awards participation for wrong choices without claiming first correctness', () => {
    const wrong = attempt({ correct: false, selectedWordId: words[1]!.wordId });
    expect(participationReward(wrong)?.id).toBe('s:q1:participation');
    expect(applyLearningEvidence({ wordId: wrong.wordId, heardCount: 1 }, wrong).firstCorrectAt).toBeUndefined();
  });
  it.each([{ attemptNo: 2 }, { hinted: true }, { heardInQuestion: false }, { kind: 'timeout' as const, selectedWordId: null }])('does not count unsupported evidence %j', (override) => {
    expect(applyLearningEvidence({ wordId: words[0]!.wordId, heardCount: 1 }, attempt(override)).firstCorrectAt).toBeUndefined();
  });
  it('uses the exact 24-hour boundary, including an epoch-zero first answer', () => {
    const progress = { wordId: words[0]!.wordId, heardCount: 1, firstCorrectAt: 0 };
    expect(isReviewDue(progress, REVIEW_DELAY_MS - 1)).toBe(false);
    expect(isReviewDue(progress, REVIEW_DELAY_MS)).toBe(true);
    expect(applyLearningEvidence(progress, attempt({ ts: REVIEW_DELAY_MS - 1 })).reviewCorrectAt).toBeUndefined();
    expect(applyLearningEvidence(progress, attempt({ ts: REVIEW_DELAY_MS })).reviewCorrectAt).toBe(REVIEW_DELAY_MS);
    expect(applyLearningEvidence(progress, attempt({ ts: REVIEW_DELAY_MS }), true).reviewCorrectAt).toBeUndefined();
  });
  it('does not allow choosing before playback, and makes hints sticky after two errors', () => {
    expect(() => reduceAnswer(question({ heardInQuestion: false }), 'select', words[0]!.wordId)).toThrow();
    const first = reduceAnswer(question(), 'select', words[1]!.wordId).question;
    expect(first.hinted).toBe(false);
    const second = reduceAnswer({ ...first, state: 'awaitingAnswer' }, 'select', words[1]!.wordId).question;
    expect(second.hinted).toBe(true);
    expect(reduceAnswer({ ...second, state: 'awaitingAnswer' }, 'select', words[0]!.wordId).question.state).toBe('completed');
  });
  it('does not fabricate a hint for a successful second choice', () => {
    const result = reduceAnswer(question({ attemptCount: 1 }), 'select', words[0]!.wordId);
    expect(result.question).toMatchObject({ state: 'completed', hinted: false });
  });
  it('records timeout only when a timed question has consumed its budget', () => {
    expect(() => reduceAnswer(question(), 'timeout', null)).toThrow();
    expect(() => reduceAnswer(question({ remainingMs: 1 }), 'timeout', null)).toThrow();
    expect(reduceAnswer(question({ remainingMs: 0 }), 'timeout', null).question.hinted).toBe(true);
    expect(participationReward(attempt({ kind: 'timeout', selectedWordId: null }))).toBeUndefined();
  });
});

describe('question selection', () => {
  const base = { id: 'session', now: REVIEW_DELAY_MS, theme, words, readyIds, random: () => 0.42, config: configSnapshot('tap', 'L1'), progress: [] };
  it('builds a bounded group with stable IDs, distinct targets and options', () => {
    const session = createSession(base)!;
    expect(session.questions).toHaveLength(5);
    expect(new Set(session.questions.map((entry) => entry.wordId)).size).toBe(5);
    for (const entry of session.questions) {
      expect(entry.optionIds).toContain(entry.wordId);
      expect(new Set(entry.optionIds).size).toBe(3);
    }
  });
  it('uses only ready words and never silently reduces options', () => {
    expect(createSession({ ...base, readyIds: new Set(words.slice(0, 2).map((word) => word.wordId)) })).toBeNull();
    expect(createSession({ ...base, config: configSnapshot('drag', 'L2'), readyIds: new Set(words.slice(0, 3).map((word) => word.wordId)) })).toBeNull();
  });
  it('limits ordinary rounds to three due reviews and uses five for explicit review', () => {
    const progress = words.map((word) => ({ wordId: word.wordId, heardCount: 1, firstCorrectAt: 0 }));
    expect(createSession({ ...base, progress })!.questions).toHaveLength(3);
    expect(createSession({ ...base, progress, reviewOnly: true })!.questions).toHaveLength(5);
  });
  it('does not put mutually confusable distractors or duplicate images together', () => {
    const limited = words.slice(0, 4);
    const confusable = { ...theme, confusablePairs: [[limited[1]!.wordId, limited[2]!.wordId] as [string, string]] };
    expect(chooseOptions(limited[0]!, limited, 4, confusable, () => 0.5)).toBeNull();
    const duplicates = limited.map((word, index) => index === 1 ? { ...word, illustration: limited[0]!.illustration } : word);
    expect(chooseOptions(duplicates[0]!, duplicates, 4, theme, () => 0.5)).toBeNull();
  });
  it('excludes draft content in release rounds', () => {
    expect(createSession({ ...base, release: true })).toBeNull();
  });
});

it('counts only active intervals and cannot add time on repeated resumes or clock rollback', () => {
  let now = 0;
  const timer = new ActiveTimer(15000, () => now);
  timer.resume(); now = 2500; timer.resume();
  expect(timer.pause()).toBe(12500);
  now = 35000;
  expect(timer.remaining()).toBe(12500);
  timer.resume(); now = 36000;
  expect(timer.remaining()).toBe(11500);
  now = 34000;
  expect(timer.pause()).toBe(11500);
});
