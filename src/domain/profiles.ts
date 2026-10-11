import type { Profile } from './models.ts';

// 合并 memoryApp 后，drill 轨道按孩子分开保存进度与目标；探索轨道在 Stage 4 内仍只服务一个孩子。
export const DEFAULT_PROFILE_ID = 'p_default';

export function defaultProfile(id: string = DEFAULT_PROFILE_ID, name = '小朋友', avatar = '🐣', now: number = Date.now()): Profile {
  return { id, name, avatar, createdAt: now, dailyNewTarget: 10, includeNonCore: false, ttsRate: 0.9,
    coins: 0, streak: 0, lastStudyDay: null, totalReviews: 0 };
}
