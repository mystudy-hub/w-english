import { describe, expect, it } from 'vitest';
import { IdleGuideClock } from '../src/domain/idle-guide.ts';

describe('idle guidance budget', () => {
  it('waits eight eligible idle seconds and resets on interaction or unavailable time', () => {
    const clock = new IdleGuideClock(0);
    expect(clock.due(7999, true)).toBe(false); expect(clock.due(8000, true)).toBe(true);
    clock.activity(8000); expect(clock.due(15999, true)).toBe(false);
    expect(clock.due(30000, false)).toBe(false);
    expect(clock.due(37999, true)).toBe(false); expect(clock.due(38000, true)).toBe(true);
  });
  it('keeps a twenty-second gap and permits at most two prompts', () => {
    const clock = new IdleGuideClock(0);
    clock.reserve(8000);
    expect(clock.due(27999, true)).toBe(false); expect(clock.due(28000, true)).toBe(true);
    clock.reserve(28000); expect(clock.due(90000, true)).toBe(false);
  });
  it('honors the persisted question budget after a reload', () => {
    const clock = new IdleGuideClock(29000, 1, 28000);
    expect(clock.due(47999, true)).toBe(false); expect(clock.due(48000, true)).toBe(true);
    clock.sync(2, 48000); expect(clock.due(100000, true)).toBe(false);
  });
});
