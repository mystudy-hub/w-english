// SRS 抽象层：定义引擎接口，方便以后从 SM-2 换成 FSRS 而不改业务代码。
// 移植来源：memoryApp/src/srs/types.ts（快照 b43afb31c9485256d2461948c8734b881d799537）。

// 用户对一次复习的作答评分（映射到 SM-2 的 0-5 质量分）
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

// 一个词在某个学习者档案下的记忆状态
export interface CardState {
  wordId: string;
  // SM-2 核心字段
  repetitions: number; // 连续答对次数
  ease: number;        // 难度系数（易度），初始 2.5
  interval: number;    // 当前间隔（天）
  due: number;         // 下次到期时间戳（ms）
  // 统计
  lastReviewed: number | null;
  reviewCount: number;
  lapses: number;      // 遗忘次数（答 again）
  learned: boolean;    // 是否已“学过”（进入复习循环）
}

export interface ReviewResult {
  next: CardState;
  wasCorrect: boolean;
}

// SRS 引擎接口：任何算法实现都要满足它
export interface SrsEngine {
  readonly name: string;
  // 新卡片初始状态
  init(wordId: string): CardState;
  // 根据作答评分推进卡片状态
  review(card: CardState, grade: ReviewGrade, now: number): ReviewResult;
}
