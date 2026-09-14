import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningDatabase } from '../src/data/database.ts';
import { LearningRepository } from '../src/data/learning-repository.ts';
import { accumulateUsage, changeUsage, defaultUsage, ForegroundUsageClock, REST_MS, shouldShowRest, type UsageCheckpoint } from '../src/domain/usage.ts';
import { readyIds, settings, theme, words } from './fixtures.ts';

const checkpoint = (overrides: Partial<UsageCheckpoint> = {}): UsageCheckpoint => ({ cycle: 0, writerId: 'visit-1', sequence: 1, cumulativeMs: 1000, now: 2000, limitMinutes: 8, ...overrides });

describe('foreground learning time', () => {
  it('counts active intervals only and retains fractional milliseconds across checkpoints', () => {
    let now = 0; const clock = new ForegroundUsageClock(() => now);
    clock.setActive(true); now = 1000.4; expect(clock.drain()).toBe(1000);
    now = 1500.8; clock.setActive(false); expect(clock.drain()).toBe(500);
    now = 90_000; expect(clock.drain()).toBe(0);
    clock.setActive(true); now += 250.4; expect(clock.drain()).toBe(251);
    now += 100; clock.setActive(false); expect(clock.drain()).toBe(100);
  });
  it('does not count negative time or count an interval twice after a clock rollback', () => {
    let now = 100; const clock = new ForegroundUsageClock(() => now);
    clock.setActive(true); now = 200; expect(clock.drain()).toBe(100);
    now = 150; expect(clock.drain()).toBe(0); now = 225; expect(clock.drain()).toBe(25);
  });
  it('uses cumulative checkpoints to recover a failed save without duplicating retries', () => {
    const first = accumulateUsage(defaultUsage(), checkpoint());
    expect(accumulateUsage(first, checkpoint())).toBe(first);
    const next = accumulateUsage(first, checkpoint({ sequence: 3, cumulativeMs: 3000, now: 4000 }));
    expect(next.elapsedMs).toBe(3000);
    expect(accumulateUsage(next, checkpoint({ sequence: 2, cumulativeMs: 2000 }))).toBe(next);
    const resumed = accumulateUsage(next, checkpoint({ writerId: 'visit-2', cumulativeMs: 200 }));
    expect(resumed.elapsedMs).toBe(3200);
  });
  it('defers a due reminder to the end of the current question, including after reload', () => {
    const due = accumulateUsage(defaultUsage(), checkpoint({ cumulativeMs: 8 * 60_000, questionId: 'current' }));
    expect(shouldShowRest(due, true, 'current')).toBe(false);
    expect(shouldShowRest(structuredClone(due), true, 'current')).toBe(false);
    expect(shouldShowRest(due, true, 'next')).toBe(true);
    expect(shouldShowRest(due, false)).toBe(true);
    const scene = accumulateUsage(defaultUsage(), checkpoint({ cumulativeMs: 8 * 60_000 }));
    expect(shouldShowRest(scene, true, 'new-round')).toBe(true);
  });
  it('offers an eight-minute reminder and rejects stale checkpoints after continuing', () => {
    const due = accumulateUsage(defaultUsage(), checkpoint({ cumulativeMs: 8 * 60_000 }));
    const reminder = changeUsage(due, 'show', 500_000);
    expect(reminder.phase).toBe('reminder');
    const next = changeUsage(reminder, 'continue', 510_000);
    expect(next).toMatchObject({ cycle: 1, elapsedMs: 0, phase: 'learning', pending: false });
    expect(accumulateUsage(next, checkpoint({ sequence: 2, cumulativeMs: 600_000 }))).toBe(next);
  });
  it('allows one full three-minute extension measured from the delayed reminder', () => {
    const due = accumulateUsage(defaultUsage(12), checkpoint({ limitMinutes: 12, cumulativeMs: 14 * 60_000, questionId: 'long-question' }));
    const reminder = changeUsage(due, 'show', 900_000);
    expect(changeUsage(reminder, 'continue', 900_001)).toBe(reminder);
    const extended = changeUsage(reminder, 'extend', 900_001);
    expect(extended).toMatchObject({ extensionUsed: true, extensionLimitMs: 17 * 60_000, phase: 'learning' });
    const almost = accumulateUsage(extended, checkpoint({ limitMinutes: 12, sequence: 2, cumulativeMs: 17 * 60_000 - 1 }));
    expect(shouldShowRest(almost, false)).toBe(false);
    const second = changeUsage(accumulateUsage(almost, checkpoint({ limitMinutes: 12, sequence: 3, cumulativeMs: 17 * 60_000 })), 'show', 1_100_000);
    expect(second.phase).toBe('reminder'); expect(changeUsage(second, 'extend', 1_100_001)).toBe(second);
  });
  it('preserves a three-minute rest deadline across reload and clamps backward wall clocks', () => {
    const due = accumulateUsage(defaultUsage(18), checkpoint({ limitMinutes: 18, cumulativeMs: 18 * 60_000 }));
    const resting = changeUsage(due, 'show', 2_000_000);
    expect(resting.restUntil).toBe(2_000_000 + REST_MS);
    const loaded = structuredClone(resting);
    expect(changeUsage(loaded, 'continue', loaded.restUntil! - 1)).toBe(loaded);
    const rollback = accumulateUsage(loaded, checkpoint({ limitMinutes: 18, writerId: 'new-visit', cumulativeMs: 0, now: 1_000_000 }));
    expect(rollback.restUntil).toBe(1_000_000 + REST_MS);
    expect(rollback.elapsedMs).toBe(18 * 60_000);
    expect(changeUsage(rollback, 'continue', rollback.restUntil!)).toMatchObject({ phase: 'learning', cycle: 1, elapsedMs: 0 });
  });
  it('does not accumulate reminder/rest time or force a lock for voluntary rest', () => {
    const reminder = changeUsage(accumulateUsage(defaultUsage(), checkpoint({ cumulativeMs: 8 * 60_000 })), 'show', 500_000);
    const unchanged = accumulateUsage(reminder, checkpoint({ sequence: 2, cumulativeMs: 900_000 }));
    expect(unchanged.elapsedMs).toBe(8 * 60_000);
    const resting = changeUsage(unchanged, 'rest', 600_000);
    expect(changeUsage(resting, 'continue', 600_000).phase).toBe('learning');
  });
});

describe('persistent usage and session rest state', () => {
  let db: LearningDatabase; let repository: LearningRepository;
  beforeEach(async () => { db = new LearningDatabase(`usage-${crypto.randomUUID()}`); repository = new LearningRepository(db); await repository.initialize(); });
  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
  it('recovers cumulative saves and commits the session deadline in the same transaction', async () => {
    const session = (await repository.startSession({ id: 'round', now: 1000, theme, words, readyIds, settings, random: () => .2 }))!;
    vi.spyOn(db.activityState, 'put').mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(repository.checkpointUsage(checkpoint())).rejects.toThrow('Quota exceeded');
    expect((await repository.usage()).elapsedMs).toBe(0);
    await repository.checkpointUsage(checkpoint({ sequence: 2, cumulativeMs: 18 * 60_000, limitMinutes: 18 }));
    const state = await repository.changeUsage('show', 0, 2_000_000);
    const reopened = new LearningRepository(db);
    expect(await reopened.usage()).toEqual(state.usage);
    expect((await reopened.session(session.id))?.restUntil).toBe(2_000_000 + REST_MS);
    await reopened.changeUsage('continue', 0, 2_000_000 + REST_MS - 1);
    expect((await reopened.usage()).phase).toBe('resting');
    await reopened.changeUsage('continue', 0, 2_000_000 + REST_MS);
    expect((await reopened.usage()).elapsedMs).toBe(0);
    expect((await reopened.session(session.id))?.restUntil).toBeUndefined();
  });
  it('rolls back the usage transition if updating the active session fails', async () => {
    await repository.startSession({ id: 'round', now: 1000, theme, words, readyIds, settings, random: () => .2 });
    await repository.checkpointUsage(checkpoint({ cumulativeMs: 18 * 60_000, limitMinutes: 18 }));
    const previous = await repository.usage();
    const fail = () => { throw new Error('Session write failed'); };
    db.sessions.hook('updating', fail);
    await expect(repository.changeUsage('show', 0, 2_000_000)).rejects.toThrow('Session write failed');
    db.sessions.hook('updating').unsubscribe(fail);
    expect(await repository.usage()).toEqual(previous);
    expect((await repository.activeSession())?.restUntil).toBeUndefined();
  });
});
