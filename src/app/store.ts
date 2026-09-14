import { useMemo } from 'react';
import { create } from 'zustand';
import { defaultGuide, defaultSettings } from '../domain/config.ts';
import type { GuideState, InteractionMode, LearningLevel, ParentSettings, SessionSnapshot, Settings, StickerReward, UsageState, WordProgress } from '../domain/models.ts';
import { defaultUsage } from '../domain/usage.ts';
import type { LoadedContent, PackProgress } from '../services/content-packs.ts';

export const useInteractionStore = create<{ mode: InteractionMode }>(() => ({ mode: 'tap' }));
export const useLevelStore = create<{ level: LearningLevel }>(() => ({ level: 'L1' }));
export const useParentStore = create<ParentSettings>(() => defaultSettings().parentSettings);
interface AppState {
  phase: 'loading' | 'ready' | 'failed'; entered: boolean; entering: boolean; parentAuthorized: boolean;
  learningAccess: 'inactive' | 'writer' | 'read-only';
  onboardingComplete: boolean; storage: 'pending' | 'persistent' | 'temporary';
  content?: LoadedContent; pendingContent?: LoadedContent; pack: PackProgress;
  progress: WordProgress[]; guide: GuideState; session?: SessionSnapshot;
  stickers: StickerReward[];
  usage: UsageState; interactionPaused: boolean;
  scenePage: number; error?: string; notice?: string; muted: boolean; updateWaiting: boolean;
  sceneThemeId: string; themePages: Record<string, number>; themeProgress: Record<string, PackProgress>;
  audioRevision: number; guidePulse: number;
  contentRecovery?: 'fallback' | 'repair' | 'app-update';
  storageIssue?: 'blocked' | 'changed' | 'newer' | 'unavailable';
}
export const useAppStore = create<AppState>(() => ({
  phase: 'loading', entered: false, entering: false, learningAccess: 'inactive', parentAuthorized: false, onboardingComplete: false, storage: 'pending',
  pack: { state: 'idle', completedBytes: 0, totalBytes: 0, percent: 0 },
  progress: [], stickers: [], guide: defaultGuide(), scenePage: 0, muted: false, updateWaiting: false, audioRevision: 0, guidePulse: 0,
  sceneThemeId: 'animal_home', themePages: {}, themeProgress: {},
  usage: defaultUsage(), interactionPaused: false,
}));
export function applySettings(settings: Settings) {
  useInteractionStore.setState({ mode: settings.interactionMode });
  useLevelStore.setState({ level: settings.learningLevel });
  useParentStore.setState(settings.parentSettings);
  useAppStore.setState({ onboardingComplete: settings.onboardingComplete });
}
export function readSettings(): Settings {
  return { key: 'local', settingsVersion: 1, onboardingComplete: useAppStore.getState().onboardingComplete,
    interactionMode: useInteractionStore.getState().mode, learningLevel: useLevelStore.getState().level, parentSettings: useParentStore.getState() };
}
export function useSettings(): Settings {
  const mode = useInteractionStore((state) => state.mode);
  const level = useLevelStore((state) => state.level);
  const parent = useParentStore();
  const complete = useAppStore((state) => state.onboardingComplete);
  return useMemo(() => ({ key: 'local', settingsVersion: 1, onboardingComplete: complete,
    interactionMode: mode, learningLevel: level, parentSettings: parent }), [mode, level, parent, complete]);
}
