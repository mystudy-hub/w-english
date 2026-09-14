import type { StickerReward, WordProgress } from './models.ts';

export const WORDS_PER_STICKER = 5;
export function missingStickers(progress: readonly WordProgress[], existingIds: ReadonlySet<string>, sessionId?: string): StickerReward[] {
  const first = new Map<string, WordProgress & { firstCorrectAt: number }>();
  for (const word of progress) if (typeof word.firstCorrectAt === 'number' && Number.isFinite(word.firstCorrectAt) && word.firstCorrectAt >= 0) {
    const previous = first.get(word.wordId);
    if (!previous || word.firstCorrectAt < previous.firstCorrectAt) first.set(word.wordId, { ...word, firstCorrectAt: word.firstCorrectAt });
  }
  const ordered = [...first.values()].sort((a, b) => a.firstCorrectAt - b.firstCorrectAt || a.wordId.localeCompare(b.wordId));
  const rewards: StickerReward[] = [];
  for (let milestone = 1; milestone <= Math.floor(ordered.length / WORDS_PER_STICKER); milestone++) {
    const id = `sticker:${milestone}`;
    if (existingIds.has(id)) continue;
    const trigger = ordered[milestone * WORDS_PER_STICKER - 1]!;
    rewards.push({ id, kind: 'sticker', milestone, wordId: trigger.wordId, ts: trigger.firstCorrectAt, ...(sessionId ? { sessionId } : {}) });
  }
  return rewards;
}
