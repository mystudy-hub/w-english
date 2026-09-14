import type { AttemptRecord, Reward, SessionSnapshot } from './models.ts';

export const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60_000;
export const ADAPTIVE_WINDOW_SIZE = 20;

/** Keep the aggregates in their own tables; prune only dispensable detailed history. */
export function historyRetentionPlan(sessions: SessionSnapshot[], attempts: AttemptRecord[], rewards: Reward[], now: number) {
  if (!Number.isFinite(now) || now < 0) throw new Error('历史清理时间无效');
  const cutoff = now - HISTORY_RETENTION_MS;
  const old = (ts: number) => Number.isFinite(ts) && ts >= 0 && ts < cutoff;
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const keep = new Set(sessions.filter((session) => !['completed', 'abandoned'].includes(session.status) || !old(session.updatedAt)).map((session) => session.id));
  for (const attempt of attempts) if (!old(attempt.ts)) keep.add(attempt.sessionId);
  for (const reward of rewards) if (reward.kind === 'participation' && !old(reward.ts)) keep.add(reward.sessionId);
  const recentFirstAttempts = attempts.filter((attempt) => {
    const session = sessionsById.get(attempt.sessionId);
    return attempt.activity === 'listenTap' && attempt.attemptNo === 1 && Number.isFinite(attempt.ts) && session?.activity !== 'tapSpell'
      && session?.questions.some((question) => question.id === attempt.questionId && question.state === 'completed');
  }).sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id)).slice(0, ADAPTIVE_WINDOW_SIZE);
  for (const attempt of recentFirstAttempts) keep.add(attempt.sessionId);
  return {
    sessionIds: sessions.filter((session) => !keep.has(session.id)).map((session) => session.id),
    attemptIds: attempts.filter((attempt) => old(attempt.ts) && !keep.has(attempt.sessionId)).map((attempt) => attempt.id),
    rewardIds: rewards.filter((reward) => reward.kind === 'participation' && old(reward.ts) && !keep.has(reward.sessionId)).map((reward) => reward.id),
  };
}
