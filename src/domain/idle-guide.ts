export class IdleGuideClock {
  private lastActivity: number;
  private count: number;
  private lastPrompt: number;
  constructor(now: number, count = 0, lastPrompt = Number.NEGATIVE_INFINITY) {
    this.lastActivity = now; this.count = count; this.lastPrompt = lastPrompt;
  }
  activity(now: number) { this.lastActivity = now; }
  sync(count: number, lastPrompt?: number) {
    this.count = Math.max(this.count, count);
    if (lastPrompt !== undefined) this.lastPrompt = Math.max(this.lastPrompt, lastPrompt);
  }
  due(now: number, eligible: boolean) {
    if (!eligible) { this.activity(now); return false; }
    return this.count < 2 && now - this.lastActivity >= 8000 && now - this.lastPrompt >= 20_000;
  }
  reserve(now: number) { this.count += 1; this.lastPrompt = now; this.lastActivity = now; }
}
