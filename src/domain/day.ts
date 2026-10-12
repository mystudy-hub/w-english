import type { ReviewGrade } from '../core/srs/index.ts';
import type { Profile } from './models.ts';

// 本地日历日（按设备时区），打卡与每日记录都用它。
export function localDay(now: number): string {
  const date = new Date(now);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isNextDay(previous: string, current: string): boolean {
  const before = new Date(`${previous}T00:00:00`).getTime();
  const after = new Date(`${current}T00:00:00`).getTime();
  return Math.round((after - before) / 86_400_000) === 1;
}

// 断签超过一天就不再显示旧连击（沿用 memoryApp 的“幽灵连击”防护）。
export function effectiveStreak(profile: Pick<Profile, 'streak' | 'lastStudyDay'>, now: number): number {
  if (!profile.lastStudyDay || profile.streak <= 0) return 0;
  const today = localDay(now);
  return profile.lastStudyDay === today || isNextDay(profile.lastStudyDay, today) ? profile.streak : 0;
}

// 金币沿用 memoryApp 的口径：答对 2 枚，轻松答对 3 枚，重做答对 1 枚，答错 0 枚。
export function coinsFor(grade: ReviewGrade, retried: boolean): number {
  if (grade === 'again') return 0;
  if (retried) return 1;
  return grade === 'easy' ? 3 : 2;
}

// 把一次作答计入档案：金币、累计练习次数与连击天数。
export function applyStudyResult(profile: Profile, input: { coins: number; reviews: number; now: number }): Profile {
  const today = localDay(input.now);
  const next: Profile = { ...profile, coins: profile.coins + input.coins, totalReviews: profile.totalReviews + input.reviews };
  if (profile.lastStudyDay === today) return next;
  next.streak = profile.lastStudyDay && isNextDay(profile.lastStudyDay, today) ? profile.streak + 1 : 1;
  next.lastStudyDay = today;
  return next;
}
