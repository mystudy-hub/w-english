import type { AttemptRecord, Question, Reward, WordProgress } from './models.ts';

export const REVIEW_DELAY_MS = 86_400_000;
export const isReviewDue = (progress: WordProgress | undefined, now: number) => progress?.firstCorrectAt !== undefined
  && progress.reviewCorrectAt === undefined && now >= progress.firstCorrectAt + REVIEW_DELAY_MS;
export function applyLearningEvidence(progress: WordProgress, attempt: AttemptRecord, clockRolledBack = false): WordProgress {
  const next = { ...progress, lastAskedAt: attempt.ts };
  if (attempt.activity !== 'listenTap' || attempt.kind !== 'select' || attempt.attemptNo !== 1 || !attempt.correct || !attempt.heardInQuestion || attempt.hinted) return next;
  if (next.firstCorrectAt === undefined) next.firstCorrectAt = attempt.ts;
  else if (!clockRolledBack && isReviewDue(next, attempt.ts)) next.reviewCorrectAt = attempt.ts;
  return next;
}
export function reduceAnswer(question: Question, kind: 'select' | 'timeout', selectedWordId: string | null) {
  if (question.state !== 'awaitingAnswer' || !question.heardInQuestion) throw new Error('请先完整听过本题');
  if (kind === 'select' && (selectedWordId === null || !question.optionIds.includes(selectedWordId))) throw new Error('选择不属于本题');
  if (kind === 'timeout' && (question.remainingMs === null || question.remainingMs > 0 || question.hinted)) throw new Error('本题尚未超时');
  const correct = kind === 'select' && selectedWordId === question.wordId;
  const attemptNo = question.attemptCount + 1;
  const completed = kind === 'select' && (correct || question.hinted);
  return {
    attemptNo, correct,
    question: { ...question, attemptCount: attemptNo, lastCorrect: correct,
      hinted: question.hinted || kind === 'timeout' || (!correct && attemptNo >= 2),
      state: completed ? 'completed' : 'feedback',
    } satisfies Question,
  };
}
export function participationReward(attempt: AttemptRecord): Reward | undefined {
  if (attempt.kind !== 'select' || !attempt.heardInQuestion) return undefined;
  return { id: `${attempt.questionId}:participation`, sessionId: attempt.sessionId, wordId: attempt.wordId, kind: 'participation', ts: attempt.ts };
}
export function progressCounts(progress: WordProgress[]) {
  return {
    explored: progress.filter((entry) => entry.exploredAt !== undefined).length,
    heard: progress.filter((entry) => entry.heardCount > 0).length,
    firstCorrect: progress.filter((entry) => entry.firstCorrectAt !== undefined).length,
    reviewCorrect: progress.filter((entry) => entry.reviewCorrectAt !== undefined).length,
  };
}
