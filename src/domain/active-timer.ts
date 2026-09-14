/** Only foreground awaiting-answer intervals consume the budget. */
export class ActiveTimer {
  private budget: number;
  private started: number | null = null;
  private readonly clock: () => number;
  private lastNow = 0;
  constructor(milliseconds: number, clock: () => number = () => performance.now()) {
    this.budget = milliseconds; this.clock = clock;
  }
  private now() { this.lastNow = Math.max(this.lastNow, this.clock()); return this.lastNow; }
  resume() { this.started ??= this.now(); }
  pause() { this.budget = this.remaining(); this.started = null; return this.budget; }
  remaining() { return Math.max(0, this.budget - (this.started === null ? 0 : this.now() - this.started)); }
}
