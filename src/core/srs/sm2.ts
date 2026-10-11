// SM-2 间隔重复算法实现（SuperMemo 2 经典算法）。
// 参考: https://super-memory.com/english/ol/sm2.htm
// 为小学生做了温和化处理：初次学习的间隔更短，遗忘惩罚不过重。
// 移植来源：memoryApp/src/srs/sm2.ts（快照 b43afb31c9485256d2461948c8734b881d799537）。

import type { CardState, ReviewGrade, ReviewResult, SrsEngine } from './types.ts';

const DAY = 24 * 60 * 60 * 1000;

// 把面向孩子的 4 档评分映射到 SM-2 的质量分 q (0-5)
const GRADE_TO_Q: Record<ReviewGrade, number> = {
  again: 2, // 没答对
  hard: 3,  // 答对但很吃力
  good: 4,  // 正常答对
  easy: 5,  // 轻松答对
};

// SM-2 可调参数（针对不同年级/难度水平可微调）
export interface Sm2Options {
  /** 最低难度系数（越大越不容易掉到谷底），默认 1.3 */
  minEase?: number;
  /** 初始难度系数，默认 2.5 */
  initialEase?: number;
  /** 复习答错后的重试间隔（分钟），默认 10 */
  retryMinutes?: number;
  /** 第一次答对后的间隔（天），默认 1 */
  intervalAfterFirst?: number;
  /** 第二次答对后的间隔（天），默认 3（原版 6，小学生用 3 更温和） */
  intervalAfterSecond?: number;
}

const DEFAULTS: Required<Sm2Options> = {
  minEase: 1.3,
  initialEase: 2.5,
  retryMinutes: 10,
  intervalAfterFirst: 1,
  intervalAfterSecond: 3,
};

export class Sm2Engine implements SrsEngine {
  readonly name = 'SM-2';
  private readonly opts: Required<Sm2Options>;

  constructor(options?: Sm2Options) {
    this.opts = { ...DEFAULTS, ...options };
  }

  init(wordId: string): CardState {
    return {
      wordId,
      repetitions: 0,
      ease: this.opts.initialEase,
      interval: 0,
      due: Date.now(),
      lastReviewed: null,
      reviewCount: 0,
      lapses: 0,
      learned: false,
    };
  }

  review(card: CardState, grade: ReviewGrade, now: number): ReviewResult {
    const q = GRADE_TO_Q[grade];
    const wasCorrect = q >= 3;

    // 复制，保持不可变
    const next: CardState = { ...card };
    next.reviewCount = card.reviewCount + 1;
    next.lastReviewed = now;
    next.learned = true;

    if (!wasCorrect) {
      // 答错：重置连续答对，间隔回到 1 天以内（孩子友好：当天稍后 / 次日再练）
      next.repetitions = 0;
      next.interval = 0;
      next.lapses = card.lapses + 1;
      // 易度下降，但有下限
      next.ease = Math.max(this.opts.minEase, card.ease - 0.2);
      // 短暂间隔后当天内再来一次
      next.due = now + this.opts.retryMinutes * 60 * 1000;
      return { next, wasCorrect };
    }

    // 答对：更新易度（SM-2 公式）
    const newEase = card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    next.ease = Math.max(this.opts.minEase, newEase);
    next.repetitions = card.repetitions + 1;

    // 计算下一间隔
    let interval: number;
    if (next.repetitions === 1) {
      interval = this.opts.intervalAfterFirst;
    } else if (next.repetitions === 2) {
      interval = this.opts.intervalAfterSecond;
    } else {
      interval = Math.round(card.interval * next.ease);
    }

    // hard 档额外收敛间隔，避免拉得太长
    if (grade === 'hard') {
      interval = Math.max(1, Math.round(interval * 0.7));
    }

    next.interval = interval;
    next.due = now + interval * DAY;
    return { next, wasCorrect };
  }
}

export const sm2 = new Sm2Engine();
