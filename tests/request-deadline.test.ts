import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRequestDeadline } from '../src/services/request-deadline.ts';

afterEach(() => vi.useRealTimers());
describe('portable request deadlines', () => {
  it('keeps the deadline active while a response body is still arriving', async () => {
    vi.useFakeTimers();
    const body = withRequestDeadline(100, async (signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const rejected = expect(body).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates parent cancellation without starting an already-cancelled request', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const reason = new DOMException('Paused', 'AbortError'); controller.abort(reason);
    const fetcher = vi.fn(async () => 'unexpected');
    await expect(withRequestDeadline(5000, fetcher, controller.signal)).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
