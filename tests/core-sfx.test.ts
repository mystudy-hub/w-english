import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
class FakeOscillator {
  type = '';
  frequency = new FakeParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
}
class FakeAudioContext {
  static last: FakeAudioContext | undefined;
  state: string;
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {});
  constructor(state = 'running') {
    this.state = state;
    FakeAudioContext.last = this;
  }
  createOscillator() { const oscillator = new FakeOscillator(); this.oscillators.push(oscillator); return oscillator; }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
}

const original = window.AudioContext;
afterEach(() => { window.AudioContext = original; FakeAudioContext.last = undefined; vi.resetModules(); });

async function load(state: 'running' | 'closed' | 'suspended' | null) {
  vi.resetModules();
  if (state === null) delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  else {
    const initial = state;
    window.AudioContext = ((class extends FakeAudioContext { constructor() { super(initial); } }) as unknown as typeof AudioContext);
  }
  return import('../src/core/sfx.ts');
}

describe('drill sound effects', () => {
  it('plays the two-note rise for a correct answer', async () => {
    const { playSfx } = await load('running');
    playSfx('correct');
    const context = FakeAudioContext.last!;
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0]!.type).toBe('sine');
    expect(context.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(659.25, 0);
    expect(context.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(880, 0.08);
    expect(context.oscillators[0]!.start).toHaveBeenCalledWith(0);
    expect(context.oscillators[0]!.stop).toHaveBeenCalledWith(0.35);
  });

  it('plays a soft falling tone for a wrong answer', async () => {
    const { playSfx } = await load('running');
    playSfx('wrong');
    const context = FakeAudioContext.last!;
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0]!.type).toBe('triangle');
    expect(context.oscillators[0]!.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(196, 0.2);
  });

  it('plays four ascending notes when a round completes', async () => {
    const { playSfx } = await load('running');
    playSfx('complete');
    const context = FakeAudioContext.last!;
    expect(context.oscillators.map((oscillator) => oscillator.frequency.setValueAtTime.mock.calls[0]![0]))
      .toEqual([523.25, 659.25, 783.99, 1046.5]);
    expect(context.gains).toHaveLength(4);
  });

  it('stays silent and never throws when the browser has no AudioContext', async () => {
    const { playSfx } = await load(null);
    expect(() => playSfx('complete')).not.toThrow();
    expect(FakeAudioContext.last).toBeUndefined();
  });

  it('stays silent after the context has been closed', async () => {
    const { playSfx } = await load('closed');
    expect(() => playSfx('correct')).not.toThrow();
    expect(FakeAudioContext.last!.oscillators).toHaveLength(0);
  });

  it('asks a suspended context to resume before scheduling sound', async () => {
    const { playSfx } = await load('suspended');
    playSfx('correct');
    const context = FakeAudioContext.last!;
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(1);
  });

  it('reuses one context across repeated calls', async () => {
    const { playSfx } = await load('running');
    playSfx('correct');
    const context = FakeAudioContext.last;
    playSfx('wrong');
    expect(FakeAudioContext.last).toBe(context);
    expect(context!.oscillators).toHaveLength(2);
  });
});
