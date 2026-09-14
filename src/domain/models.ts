import type { ContentManifest } from '../data/content-schema.ts';

export type InteractionMode = 'tap' | 'drag';
export type LearningLevel = 'L1' | 'L2' | 'L3';
export interface ParentSettings {
  volumeCap: number;
  reducedMotion: boolean;
  guideEnabled: boolean | null;
  screenTimeMinutes: 8 | 12 | 18;
  bedtimeMode: boolean;
  lockLevel: boolean;
  micEnabled: boolean;
}
export interface Settings {
  key: 'local'; settingsVersion: 1; onboardingComplete: boolean;
  interactionMode: InteractionMode; learningLevel: LearningLevel; parentSettings: ParentSettings;
}
export interface UsageState {
  key: 'local'; usageVersion: 1; cycle: number; elapsedMs: number; limitMinutes: 8 | 12 | 18;
  phase: 'learning' | 'reminder' | 'resting'; pending: boolean; pendingQuestionId?: string;
  extensionUsed: boolean; extensionLimitMs?: number; restUntil?: number; updatedAt: number;
  writerId?: string; writerSequence?: number; writerCumulativeMs?: number;
}
export interface ConfigSnapshot {
  interactionMode: InteractionMode; learningLevel: LearningLevel;
  optionCount: 3 | 4; timeLimitMs: number | null;
}
export interface WordProgress {
  wordId: string; heardCount: number; exploredAt?: number; firstCorrectAt?: number;
  reviewCorrectAt?: number; lastAskedAt?: number;
}
export type GuideStep = 'welcome' | 'explore_one' | 'hear_one' | 'try_listen' | 'round_end' | 'done';
export interface GuideState { key: 'local'; guideVersion: 1; stepId: GuideStep; completedStepIds: GuideStep[] }
export type QuestionState = 'loading' | 'promptPlaying' | 'awaitingAnswer' | 'feedback' | 'completed';
export interface SpellingSnapshot {
  tiles: number[]; placed: number[]; heardParts: number[]; pendingPart?: number; skipped: boolean;
}
export interface Question {
  id: string; wordId: string; optionIds: string[]; state: QuestionState;
  attemptCount: number; hinted: boolean; heardInQuestion: boolean;
  remainingMs: number | null; lastCorrect?: boolean;
  idlePromptCount?: number; lastIdlePromptAt?: number;
  spelling?: SpellingSnapshot;
}
export interface SessionSnapshot {
  id: string; status: 'active' | 'completed' | 'abandoned'; themeId: string;
  contentVersion: string; configSnapshot: ConfigSnapshot; questionIds: string[];
  manifestId?: string;
  activity?: 'listenTap' | 'tapSpell';
  contentStage?: 0 | 1 | 2;
  restUntil?: number;
  guideIntroPlayed?: boolean; guideOutroPlayed?: boolean;
  currentQuestionIndex: number; questions: Question[]; updatedAt: number; startedAt: number;
  clockRolledBack: boolean;
}
export interface AttemptRecord {
  id: string; sessionId: string; questionId: string; wordId: string; contentVersion: string;
  ts: number; activity: 'listenTap' | 'tapSpell' | 'feed'; attemptNo: number;
  kind: 'select' | 'timeout'; selectedWordId: string | null;
  correct: boolean; heardInQuestion: boolean; hinted: boolean;
}
export interface ParticipationReward { id: string; sessionId: string; wordId: string; kind: 'participation'; ts: number }
export interface StickerReward { id: string; sessionId?: string; wordId: string; kind: 'sticker'; milestone: number; ts: number }
export type Reward = ParticipationReward | StickerReward;
export type PackState = 'downloading' | 'ready' | 'active' | 'failed' | 'degraded' | 'incomplete' | 'quota' | 'paused';
export interface ContentPackRecord {
  id: string; contentVersion: string; state: PackState; manifest: ContentManifest;
  verifiedIds: string[]; updatedAt: number; completedBytes: number; totalBytes: number; error?: string;
  activatedAt?: number; manifestUrl?: string;
  requestedThemeIds?: string[]; readyThemeIds?: string[]; activeThemeId?: string;
}
