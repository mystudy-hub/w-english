import type { ConfigSnapshot, GuideState, InteractionMode, LearningLevel, Settings } from './models.ts';

export const INTERACTION = {
  tap: { touchTargetMin: 80, gapMin: 16, allowDragDrop: false, showTextLabels: false, guideDefaultOn: true },
  drag: { touchTargetMin: 64, gapMin: 12, allowDragDrop: true, showTextLabels: true, guideDefaultOn: false },
} satisfies Record<InteractionMode, { touchTargetMin: number; gapMin: number; allowDragDrop: boolean; showTextLabels: boolean; guideDefaultOn: boolean }>;
export const LEVELS = {
  L1: { optionCount: 3, timeLimitMs: null, phonicsStage: 1, definition: 'en_young', label: '启蒙' },
  L2: { optionCount: 4, timeLimitMs: null, phonicsStage: 2, definition: 'en_young', label: '拼合' },
  L3: { optionCount: 4, timeLimitMs: 15_000, phonicsStage: 4, definition: 'en_older', label: '进阶' },
} as const;
export function defaultSettings(): Settings {
  return { key: 'local', settingsVersion: 1, onboardingComplete: false, interactionMode: 'tap', learningLevel: 'L1',
    parentSettings: { volumeCap: 0.7, reducedMotion: false, guideEnabled: null, screenTimeMinutes: 8, bedtimeMode: false, lockLevel: false, micEnabled: false } };
}
export function configSnapshot(mode: InteractionMode, level: LearningLevel): ConfigSnapshot {
  return { interactionMode: mode, learningLevel: level, optionCount: LEVELS[level].optionCount, timeLimitMs: LEVELS[level].timeLimitMs };
}
export const guideEnabled = (settings: Settings) => settings.parentSettings.guideEnabled ?? INTERACTION[settings.interactionMode].guideDefaultOn;
export const reducedMotion = (settings: Settings, system: boolean) => system || settings.parentSettings.reducedMotion;
export const defaultGuide = (): GuideState => ({ key: 'local', guideVersion: 1, stepId: 'welcome', completedStepIds: [] });
export const GUIDE_STEPS = ['welcome', 'explore_one', 'hear_one', 'try_listen', 'round_end', 'done'] as const;
export function advanceGuide(state: GuideState, step: typeof GUIDE_STEPS[number]): GuideState {
  const complete = new Set(state.completedStepIds);
  // Later actions imply the prerequisite discovery actions have been completed.
  for (let index = 0; index <= GUIDE_STEPS.indexOf(step); index++) complete.add(GUIDE_STEPS[index]!);
  const next = GUIDE_STEPS.find((candidate) => !complete.has(candidate)) ?? 'done';
  return { ...state, stepId: next, completedStepIds: [...complete] };
}
