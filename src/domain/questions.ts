import type { ThemeConfig, WordEntry } from '../data/content-schema.ts';
import type { ConfigSnapshot, SessionSnapshot, WordProgress } from './models.ts';
import { isReviewDue } from './learning.ts';

export function shuffled<T>(input: readonly T[], random: () => number): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
const imageIdentity = (word: WordEntry) => word.illustration.type === 'emoji' ? word.illustration.value : word.illustration.src;
export function chooseOptions(target: WordEntry, pool: WordEntry[], count: number, theme: ThemeConfig, random: () => number): string[] | null {
  const blocked = new Set(theme.confusablePairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const compatible = (a: WordEntry, b: WordEntry) => a.wordId !== b.wordId && imageIdentity(a) !== imageIdentity(b) && !blocked.has(`${a.wordId}|${b.wordId}`);
  const candidates = shuffled(pool.filter((candidate) => compatible(target, candidate)), random);
  const search = (selected: WordEntry[], from: number): WordEntry[] | null => {
    if (selected.length === count) return selected;
    if (candidates.length - from < count - selected.length) return null;
    for (let i = from; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      if (!selected.every((entry) => compatible(entry, candidate))) continue;
      const found = search([...selected, candidate], i + 1);
      if (found) return found;
    }
    return null;
  };
  const options = search([target], 0);
  return options ? shuffled(options.map((word) => word.wordId), random) : null;
}

export function createSession(input: {
  id: string; now: number; theme: ThemeConfig; words: WordEntry[]; progress: WordProgress[];
  config: ConfigSnapshot; readyIds: ReadonlySet<string>; random: () => number; reviewOnly?: boolean; release?: boolean; manifestId?: string;
  contentStage?: 0 | 1 | 2;
}): SessionSnapshot | null {
  const { id, now, theme, words, progress, config, readyIds, random } = input;
  const byId = new Map(progress.map((entry) => [entry.wordId, entry]));
  const allowed = new Set(theme.listenTapWordIds);
  const pool = words.filter((word) => allowed.has(word.wordId) && readyIds.has(word.wordId) && (!input.release || word.review.status === 'audio_approved'));
  if (pool.length < config.optionCount) return null;
  const ordered = shuffled(pool, random).sort((a, b) => (byId.get(a.wordId)?.lastAskedAt ?? 0) - (byId.get(b.wordId)?.lastAskedAt ?? 0));
  const due = ordered.filter((word) => isReviewDue(byId.get(word.wordId), now));
  const first = ordered.filter((word) => byId.get(word.wordId)?.firstCorrectAt === undefined);
  const dueIds = new Set(due.map((word) => word.wordId));
  const desired = input.reviewOnly ? due : [...due.slice(0, 3), ...first, ...ordered.filter((word) => !dueIds.has(word.wordId))];
  const seen = new Set<string>();
  const questions: SessionSnapshot['questions'] = [];
  for (const target of desired) {
    if (seen.has(target.wordId)) continue;
    seen.add(target.wordId);
    const options = chooseOptions(target, pool, config.optionCount, theme, random);
    if (!options) continue;
    questions.push({ id: `${id}:q${questions.length + 1}`, wordId: target.wordId, optionIds: options,
      state: 'loading', attemptCount: 0, hinted: false, heardInQuestion: false, remainingMs: config.timeLimitMs });
    if (questions.length === 5) break;
  }
  if (!questions.length) return null;
  return { id, status: 'active', themeId: theme.themeId, contentVersion: theme.contentVersion, configSnapshot: { ...config },
    contentStage: input.contentStage,
    ...(input.manifestId ? { manifestId: input.manifestId } : {}),
    questionIds: questions.map((question) => question.id), currentQuestionIndex: 0, questions, updatedAt: now, startedAt: now, clockRolledBack: false };
}
