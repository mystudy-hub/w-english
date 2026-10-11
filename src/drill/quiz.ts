// 课本轨道的出题逻辑：从记忆App（快照 b43afb31c9485256d2461948c8734b881d799537 的 src/study/quiz.ts）移植并适配 v4 词条。
// 与 memoryApp 的差别：只有实施规格 §13.4 列出的五种题型；例句、释义与音标在 v4 里必填，所以不再需要模板兜底。
import type { TextbookWordEntry } from '../data/content-schema.ts';

export type PracticeMode = 'choice_en2zh' | 'choice_zh2en' | 'spelling' | 'listening' | 'flip';

export const MODE_LABELS: Record<PracticeMode, string> = {
  choice_en2zh: '看英文选中文',
  choice_zh2en: '看中文选英文',
  spelling: '拼写 / 听写',
  listening: '听音辨词',
  flip: '翻卡自评',
};

export const DEFAULT_MODES: PracticeMode[] = ['choice_en2zh', 'choice_zh2en', 'listening', 'spelling'];

export interface ChoiceQuestion {
  mode: 'choice_en2zh' | 'choice_zh2en';
  word: TextbookWordEntry;
  prompt: string;    // 题干（英文或中文）
  options: string[]; // 选项文本
  answer: string;    // 正确选项文本
  speakText: string; // 该题可朗读的英文
}
export interface ListeningQuestion {
  mode: 'listening';
  word: TextbookWordEntry;
  options: string[];
  answer: string;
  speakText: string;
}
export interface SpellingQuestion {
  mode: 'spelling';
  word: TextbookWordEntry;
  hintZh: string;
  answer: string;
  speakText: string;
}
export interface FlipQuestion {
  mode: 'flip';
  word: TextbookWordEntry;
  speakText: string;
}
export type Question = ChoiceQuestion | ListeningQuestion | SpellingQuestion | FlipQuestion;

// Fisher-Yates；随机源可注入，测试与试听才有确定结果。
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

// 干扰项：先取同单元同词性的词，再退回同单元，最后退回整个词库；按文本去重。
export function distractors(target: TextbookWordEntry, pool: readonly TextbookWordEntry[], field: 'word' | 'zh', count: number, random?: () => number): TextbookWordEntry[] {
  const value = (word: TextbookWordEntry) => field === 'word' ? word.word : word.definition.zh;
  const seen = new Set([value(target).trim().toLowerCase()]);
  const picked: TextbookWordEntry[] = [];
  const pickFrom = (list: readonly TextbookWordEntry[]) => {
    for (const word of shuffle(list, random)) {
      const candidate = value(word).trim();
      if (!candidate || seen.has(candidate.toLowerCase())) continue;
      seen.add(candidate.toLowerCase());
      picked.push(word);
      if (picked.length >= count) return;
    }
  };
  const unit = target.textbook.unit;
  const others = pool.filter((word) => word.wordId !== target.wordId);
  pickFrom(others.filter((word) => word.textbook.unit === unit && word.textbook.pos === target.textbook.pos));
  if (picked.length < count) pickFrom(others.filter((word) => word.textbook.unit === unit));
  if (picked.length < count) pickFrom(others);
  return picked;
}

// 根据词与启用模式生成一道题；选项不足或模式全不可用时降级到翻卡。
export function makeQuestion(word: TextbookWordEntry, pool: readonly TextbookWordEntry[], enabled: readonly PracticeMode[], random?: () => number): Question {
  const usable = enabled.filter((mode) => {
    if (mode === 'flip') return true;
    // 选择题与听音题都需要至少一个可选干扰项
    return distractors(word, pool, mode === 'choice_en2zh' ? 'zh' : 'word', 1, random).length > 0;
  });
  const candidates = usable.length ? usable : ['flip' as PracticeMode];
  const mode = candidates[Math.floor((random ?? Math.random)() * candidates.length)] ?? 'flip';

  if (mode === 'choice_en2zh') {
    const options = shuffle([word, ...distractors(word, pool, 'zh', 3, random)], random).map((entry) => entry.definition.zh);
    return { mode, word, prompt: word.word, options, answer: word.definition.zh, speakText: word.word };
  }
  if (mode === 'choice_zh2en') {
    const options = shuffle([word, ...distractors(word, pool, 'word', 3, random)], random).map((entry) => entry.word);
    return { mode, word, prompt: word.definition.zh, options, answer: word.word, speakText: word.word };
  }
  if (mode === 'listening') {
    const options = shuffle([word, ...distractors(word, pool, 'word', 3, random)], random).map((entry) => entry.word);
    return { mode, word, options, answer: word.word, speakText: word.word };
  }
  if (mode === 'spelling') {
    return { mode, word, hintZh: word.definition.zh, answer: word.word, speakText: word.word };
  }
  return { mode: 'flip', word, speakText: word.word };
}

// 拼写校对：忽略大小写、首尾空格、空格与连字符差异（短语同样适用）。
export function checkSpelling(input: string, answer: string): boolean {
  const normalise = (value: string) => value.trim().toLowerCase().replace(/[\s'’-]+/g, '');
  return normalise(input) === normalise(answer);
}

// 拼写题的可摆放图块：单词是单个字母，短语是词元。
export function spellingTiles(word: TextbookWordEntry): string[] {
  return [...word.spelling];
}
