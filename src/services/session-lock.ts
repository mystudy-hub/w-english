export interface LearningLocks {
  request(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<void>): Promise<void>;
}
interface Acquisition {
  cancelled: boolean; accepting: boolean;
  granted: Promise<boolean>; resolve: (value: boolean) => void;
  done: Promise<void>; releaseHold?: () => void; writes: Set<Promise<unknown>>;
}

/** Own the whole visit, and finish in-flight transactions before handing it over. */
export class SessionLock {
  private acquisition?: Acquisition;
  private settling: Promise<void> = Promise.resolve();
  private readonly locks: () => LearningLocks | undefined;
  constructor(locks: () => LearningLocks | undefined = () => globalThis.navigator?.locks) { this.locks = locks; }
  get supported() { return Boolean(this.locks()); }
  get held() { return Boolean(this.acquisition?.accepting && !this.acquisition.cancelled); }

  acquire(): Promise<boolean> {
    if (this.acquisition) return this.acquisition.granted;
    const locks = this.locks();
    if (!locks) return Promise.resolve(false);
    let resolve!: (value: boolean) => void;
    const granted = new Promise<boolean>((settle) => { resolve = settle; });
    const current: Acquisition = { cancelled: false, accepting: false, granted, resolve, done: Promise.resolve(), writes: new Set() };
    this.acquisition = current;
    current.done = this.settling.then(async () => {
      if (current.cancelled) return;
      await locks.request('w-english:learning-writer', { ifAvailable: true }, async (lock) => {
        if (!lock || current.cancelled) { resolve(false); return; }
        await new Promise<void>((release) => {
          current.releaseHold = release; current.accepting = true; resolve(true);
        });
      });
    }).catch(() => resolve(false)).finally(() => {
      current.accepting = false; resolve(false);
      if (this.acquisition === current) this.acquisition = undefined;
    });
    this.settling = current.done;
    return granted;
  }

  write<T>(work: () => Promise<T>): Promise<T> {
    const current = this.acquisition;
    if (!current?.accepting || current.cancelled) return Promise.reject(new Error('请从欢迎页重新进入后再保存学习记录'));
    const task = Promise.resolve().then(work);
    current.writes.add(task);
    return task.finally(() => { current.writes.delete(task); });
  }

  release(): Promise<void> {
    const current = this.acquisition;
    if (!current) return this.settling;
    current.cancelled = true; current.accepting = false; current.resolve(false);
    this.acquisition = undefined;
    void Promise.allSettled([...current.writes]).then(() => current.releaseHold?.());
    return current.done;
  }
}
