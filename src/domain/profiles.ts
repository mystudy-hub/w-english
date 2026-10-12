import type { Profile } from './models.ts';

// 合并 memoryApp 后，drill 轨道按孩子分开保存进度与目标；探索轨道在 Stage 4 内仍只服务一个孩子。
export const DEFAULT_PROFILE_ID = 'p_default';

export function defaultProfile(id: string = DEFAULT_PROFILE_ID, name = '小朋友', avatar = '🐣', now: number = Date.now()): Profile {
  return { id, name, avatar, createdAt: now, dailyNewTarget: 10, includeNonCore: false, ttsRate: 0.9,
    coins: 0, streak: 0, lastStudyDay: null, totalReviews: 0 };
}

// 新增档案的 id：时间戳 + 随机后缀，与默认档案不冲突。
export function newProfileId(now: number = Date.now()): string {
  return `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// 家长可选的档案头像；drill 首页与家长页共用同一组。
export const PROFILE_AVATARS = ['🐣', '🐯', '🐼', '🦊', '🐳', '🦉', '🚀', '⭐'] as const;

export function createProfile(input: { name: string; avatar?: string; dailyNewTarget?: number; now?: number }): Profile {
  const now = input.now ?? Date.now();
  const profile = defaultProfile(newProfileId(now), input.name.trim() || '小朋友', input.avatar ?? PROFILE_AVATARS[0], now);
  return { ...profile, dailyNewTarget: input.dailyNewTarget ?? profile.dailyNewTarget };
}
