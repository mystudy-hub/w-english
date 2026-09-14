import type { UsageState } from './models.ts';

export const REST_MS = 3 * 60_000;
export interface UsageCheckpoint {
  cycle: number; writerId: string; sequence: number; cumulativeMs: number; now: number;
  limitMinutes: 8 | 12 | 18; questionId?: string;
}
export type UsageAction = 'show' | 'extend' | 'rest' | 'continue';
export function defaultUsage(limitMinutes: 8 | 12 | 18 = 8): UsageState {
  return { key: 'local', usageVersion: 1, cycle: 0, elapsedMs: 0, limitMinutes, phase: 'learning', pending: false, extensionUsed: false, updatedAt: 0 };
}
export function usageLimit(state: UsageState) {
  return state.limitMinutes === 12 && state.extensionUsed ? state.extensionLimitMs ?? 15 * 60_000 : state.limitMinutes * 60_000;
}
export function accumulateUsage(state: UsageState, input: UsageCheckpoint): UsageState {
  if (input.cycle !== state.cycle || (input.writerId === state.writerId && input.sequence <= (state.writerSequence ?? 0))) return state;
  if (!Number.isFinite(input.cumulativeMs) || input.cumulativeMs < 0 || !Number.isFinite(input.now) || input.now < 0) throw new Error('使用时间无效');
  const previous = input.writerId === state.writerId ? state.writerCumulativeMs ?? 0 : 0;
  if (input.cumulativeMs < previous) return state;
  const delta = input.cumulativeMs - previous;
  const next: UsageState = { ...state, limitMinutes: input.limitMinutes, writerId: input.writerId, writerSequence: input.sequence,
    writerCumulativeMs: input.cumulativeMs, updatedAt: input.now };
  if (state.phase === 'resting') {
    // A clock rollback must not turn a three-minute rest into an indefinite lock.
    if (input.now < state.updatedAt && state.restUntil !== undefined) next.restUntil = input.now + Math.max(0, Math.min(REST_MS, state.restUntil - state.updatedAt));
    return next;
  }
  if (state.phase === 'learning') next.elapsedMs += delta;
  if (next.elapsedMs >= usageLimit(next)) {
    if (!next.pending) { next.pending = true; next.pendingQuestionId = input.questionId; }
  } else { next.pending = false; next.pendingQuestionId = undefined; next.phase = 'learning'; }
  return next;
}
export function shouldShowRest(state: UsageState, answering: boolean, questionId?: string) {
  return state.phase !== 'learning' || (state.pending && (!answering || !state.pendingQuestionId || state.pendingQuestionId !== questionId));
}
export function changeUsage(state: UsageState, action: UsageAction, now: number): UsageState {
  if (!Number.isFinite(now) || now < 0) throw new Error('使用时间无效');
  if (action === 'show' && state.phase === 'learning' && state.pending) {
    return state.limitMinutes === 18 ? { ...state, phase: 'resting', pending: false, pendingQuestionId: undefined, restUntil: now + REST_MS, updatedAt: now }
      : { ...state, phase: 'reminder', updatedAt: now };
  }
  if (action === 'extend' && state.phase === 'reminder' && state.limitMinutes === 12 && !state.extensionUsed) {
    return { ...state, phase: 'learning', pending: false, pendingQuestionId: undefined, extensionUsed: true, extensionLimitMs: state.elapsedMs + REST_MS, updatedAt: now };
  }
  if (action === 'rest' && state.phase === 'reminder') {
    return { ...state, phase: 'resting', pending: false, pendingQuestionId: undefined, restUntil: now, updatedAt: now };
  }
  if (action === 'continue' && ((state.phase === 'reminder' && state.limitMinutes === 8)
    || (state.phase === 'resting' && now >= (state.restUntil ?? now)))) {
    return { ...defaultUsage(state.limitMinutes), cycle: state.cycle + 1, updatedAt: now };
  }
  return state;
}

/** Measure visible child activity with a monotonic clock, retaining sub-ms remainder. */
export class ForegroundUsageClock {
  private started?: number; private pending = 0; private last = 0;
  constructor(private readonly clock: () => number = () => performance.now()) {}
  private now() { this.last = Math.max(this.last, this.clock()); return this.last; }
  setActive(active: boolean) {
    const now = this.now();
    if (this.started !== undefined) this.pending += now - this.started;
    this.started = active ? now : undefined;
  }
  drain() {
    const now = this.now();
    if (this.started !== undefined) { this.pending += now - this.started; this.started = now; }
    const elapsed = Math.floor(this.pending); this.pending -= elapsed; return elapsed;
  }
}
