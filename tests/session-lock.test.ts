import { describe, expect, it } from 'vitest';
import { SessionLock, type LearningLocks } from '../src/services/session-lock.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
function lockHost() {
  let held = false;
  let blocked: Promise<void> | undefined;
  let requests = 0;
  const locks: LearningLocks = {
    async request(_name, _options, callback) {
      requests += 1;
      if (blocked) await blocked;
      if (held) { await callback(null); return; }
      held = true;
      try { await callback({}); } finally { held = false; }
    },
  };
  return { locks, delay: (promise: Promise<void>) => { blocked = promise; }, get requests() { return requests; }, get held() { return held; } };
}

describe('learning writer ownership', () => {
  it('permits only one visit and hands over after release', async () => {
    const host = lockHost(); const first = new SessionLock(() => host.locks); const second = new SessionLock(() => host.locks);
    expect(await first.acquire()).toBe(true);
    expect(await first.acquire()).toBe(true);
    expect(await second.acquire()).toBe(false);
    await first.release();
    expect(await second.acquire()).toBe(true);
    expect(first.held).toBe(false); expect(second.held).toBe(true);
    await second.release();
  });

  it('invalidates a pending grant and waits for its callback before reacquiring', async () => {
    const host = lockHost(); const gate = deferred<void>(); host.delay(gate.promise);
    const lock = new SessionLock(() => host.locks);
    const old = lock.acquire();
    await Promise.resolve();
    expect(host.requests).toBe(1);
    const released = lock.release(); const next = lock.acquire();
    expect(await old).toBe(false);
    expect(lock.held).toBe(false);
    expect(host.requests).toBe(1);
    gate.resolve(); await released;
    expect(await next).toBe(true);
    expect(lock.held).toBe(true);
    await lock.release();
    expect(host.held).toBe(false);
  });

  it('drains accepted writes before release, rejects late writes and preserves newer ownership', async () => {
    const host = lockHost(); const lock = new SessionLock(() => host.locks);
    await lock.acquire();
    const transaction = deferred<number>();
    const writing = lock.write(() => transaction.promise);
    const released = lock.release(); const reacquired = lock.acquire();
    expect(lock.held).toBe(false);
    expect(host.held).toBe(true);
    await expect(lock.write(async () => 2)).rejects.toThrow('欢迎页');
    transaction.resolve(1);
    expect(await writing).toBe(1); await released;
    expect(await reacquired).toBe(true);
    expect(await lock.write(async () => 3)).toBe(3);
    expect(lock.held).toBe(true);
    await lock.release();
  });

  it('releases even after a write fails, and provides no writer without Web Locks', async () => {
    const unsupported = new SessionLock(() => undefined);
    expect(unsupported.supported).toBe(false); expect(await unsupported.acquire()).toBe(false);
    await expect(unsupported.write(async () => {})).rejects.toThrow();
    const host = lockHost(); const lock = new SessionLock(() => host.locks);
    await lock.acquire();
    const writing = lock.write(async () => { throw new Error('Storage failed'); });
    const released = lock.release();
    await expect(writing).rejects.toThrow('Storage failed'); await released;
    expect(host.held).toBe(false);
  });
});
