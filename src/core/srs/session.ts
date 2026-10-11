// 每日学习会话构建：挑出“今天要学的新词”和“到期要复习的词”。
// 移植来源：memoryApp/src/srs/session.ts（快照 b43afb31c9485256d2461948c8734b881d799537）。
// 与原实现的唯一差别：词表与进度由调用方注入，不再直接 import 某一本书的词库。

export interface SrsWord {
  id: string;
  core: boolean;
  unit: number;
}

export interface SessionProgress {
  learned: boolean;
  due: number;
  interval: number;
}

export interface SessionPlan {
  dueReviews: SrsWord[]; // 到期需要复习的词
  newWords: SrsWord[];   // 今天要学的新词
  all: SrsWord[];        // 合并后的本次练习序列
}

export interface SessionInput {
  words: readonly SrsWord[];
  progress: ReadonlyMap<string, SessionProgress>;
  dailyNewTarget: number;
  includeNonCore: boolean;
  unit?: number;
  wordIds?: readonly string[];
  now?: number;
}

// 可用词表（根据设置决定是否含非核心/专有名词）
export function availableWords(words: readonly SrsWord[], includeNonCore: boolean): SrsWord[] {
  return includeNonCore ? [...words] : words.filter((word) => word.core);
}

// 构建今日计划
export function buildSession(input: SessionInput): SessionPlan {
  const now = input.now ?? Date.now();

  // 如果指定了具体 wordIds（如消灭错词本专项）
  if (input.wordIds && input.wordIds.length > 0) {
    const idSet = new Set(input.wordIds);
    const selected = input.words.filter((word) => idSet.has(word.id));
    return { dueReviews: selected, newWords: [], all: selected };
  }

  let pool = availableWords(input.words, input.includeNonCore);
  if (input.unit) {
    pool = pool.filter((word) => word.unit === input.unit);
  }

  const dueReviews: SrsWord[] = [];
  const newCandidates: SrsWord[] = [];

  for (const word of pool) {
    const progress = input.progress.get(word.id);
    if (!progress || !progress.learned) {
      newCandidates.push(word);
    } else if (progress.due <= now) {
      dueReviews.push(word);
    }
  }

  // 如果指定了单元，但没有任何到期词或新词（都已学过），则将该单元全部词排入进行整单元强化复习
  if (input.unit && dueReviews.length === 0 && newCandidates.length === 0) {
    return { dueReviews: pool, newWords: [], all: [...pool] };
  }

  // 到期复习：按到期时间升序（越早到期越先复习）
  dueReviews.sort((a, b) => (input.progress.get(a.id)?.due ?? 0) - (input.progress.get(b.id)?.due ?? 0));

  // 新词：保持教材顺序（按单元、按词表原顺序），取每日目标数量（若指定单元则不限每日目标）
  const targetCount = input.unit ? newCandidates.length : Math.max(0, input.dailyNewTarget);
  const newWords = newCandidates.slice(0, targetCount);

  // 本次练习序列：先复习到期词，再学新词
  const all = [...dueReviews, ...newWords];

  return { dueReviews, newWords, all };
}

// 整体掌握度统计
export interface MasteryStats {
  total: number;    // 可学总词数
  learned: number;  // 已进入复习循环的词数
  mastered: number; // 已“掌握”（间隔 >= 7 天）
  dueNow: number;   // 当前到期待复习
}

export function masteryStats(input: {
  words: readonly SrsWord[];
  progress: ReadonlyMap<string, SessionProgress>;
  includeNonCore: boolean;
  now?: number;
}): MasteryStats {
  const now = input.now ?? Date.now();
  const pool = availableWords(input.words, input.includeNonCore);
  let learned = 0;
  let mastered = 0;
  let dueNow = 0;
  for (const word of pool) {
    const progress = input.progress.get(word.id);
    if (progress?.learned) {
      learned += 1;
      if (progress.interval >= 7) mastered += 1;
      if (progress.due <= now) dueNow += 1;
    }
  }
  return { total: pool.length, learned, mastered, dueNow };
}
