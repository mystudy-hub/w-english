/** AbortController works on the minimum targets, without AbortSignal.any/timeout. */
export async function withRequestDeadline<T>(milliseconds: number, work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancelled = () => controller.abort(parent?.reason ?? new DOMException('请求已取消', 'AbortError'));
  if (parent?.aborted) cancelled(); else parent?.addEventListener('abort', cancelled, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('请求超时，请重试', 'TimeoutError')), milliseconds);
  try { controller.signal.throwIfAborted(); return await work(controller.signal); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', cancelled); }
}
