import { describe, expect, it } from 'vitest';
import { applyStudyResult, coinsFor, effectiveStreak, isNextDay, localDay } from '../src/domain/day.ts';
import { defaultProfile } from '../src/domain/profiles.ts';

const DAY = 86_400_000;
// 用本地中午做基准，避免时区把日期推到相邻一天
const base = new Date(2026, 9, 11, 12, 0, 0).getTime();

describe('local day helpers', () => {
  it('writes the local calendar day, not the UTC one', () => {
    expect(localDay(base)).toBe('2026-10-11');
    expect(localDay(base + DAY)).toBe('2026-10-12');
  });

  it('only treats the immediately following day as next day', () => {
    expect(isNextDay('2026-10-11', '2026-10-12')).toBe(true);
    expect(isNextDay('2026-10-11', '2026-10-13')).toBe(false);
    expect(isNextDay('2026-10-11', '2026-10-11')).toBe(false);
  });

  it('drops a streak that was missed for more than one day', () => {
    expect(effectiveStreak({ streak: 4, lastStudyDay: '2026-10-11' }, base)).toBe(4);
    expect(effectiveStreak({ streak: 4, lastStudyDay: '2026-10-10' }, base)).toBe(4);
    expect(effectiveStreak({ streak: 4, lastStudyDay: '2026-10-09' }, base)).toBe(0);
    expect(effectiveStreak({ streak: 0, lastStudyDay: '2026-10-11' }, base)).toBe(0);
    expect(effectiveStreak({ streak: 4, lastStudyDay: null }, base)).toBe(0);
  });

  it('awards the same coins memoryApp did', () => {
    expect(coinsFor('again', false)).toBe(0);
    expect(coinsFor('good', false)).toBe(2);
    expect(coinsFor('hard', false)).toBe(2);
    expect(coinsFor('easy', false)).toBe(3);
    expect(coinsFor('good', true)).toBe(1);
    expect(coinsFor('easy', true)).toBe(1);
  });

  it('extends the streak on the next day and restarts it after a gap', () => {
    const first = applyStudyResult({ ...defaultProfile(), lastStudyDay: null }, { coins: 2, reviews: 1, now: base });
    expect(first).toMatchObject({ coins: 2, totalReviews: 1, streak: 1, lastStudyDay: '2026-10-11' });

    const nextDay = applyStudyResult({ ...first, lastStudyDay: '2026-10-10' }, { coins: 3, reviews: 2, now: base });
    expect(nextDay).toMatchObject({ coins: 5, totalReviews: 3, streak: 2, lastStudyDay: '2026-10-11' });

    const afterGap = applyStudyResult({ ...first, streak: 9, lastStudyDay: '2026-10-01' }, { coins: 0, reviews: 1, now: base });
    expect(afterGap).toMatchObject({ streak: 1, lastStudyDay: '2026-10-11' });

    const sameDay = applyStudyResult({ ...first, streak: 3, lastStudyDay: '2026-10-11' }, { coins: 2, reviews: 1, now: base + 3600_000 });
    expect(sameDay).toMatchObject({ streak: 3, coins: 4, totalReviews: 2, lastStudyDay: '2026-10-11' });
  });
});
