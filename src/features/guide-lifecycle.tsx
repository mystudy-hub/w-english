import { useEffect } from 'react';
import { audio, canSaveLearning, playGuide, refreshRecords, repository } from '../app/runtime.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { advanceGuide, guideEnabled } from '../domain/config.ts';

export function GuideLifecycle({ route }: { route: string }) {
  const settings = useSettings();
  const entered = useAppStore((state) => state.entered);
  const storage = useAppStore((state) => state.storage);
  const welcomeDone = useAppStore((state) => state.guide.completedStepIds.includes('welcome'));
  const muted = useAppStore((state) => state.muted);
  const paused = useAppStore((state) => state.interactionPaused);
  useAppStore((state) => state.audioRevision);
  const available = audio.has('guide#welcome');
  const hasSession = useAppStore((state) => Boolean(state.session));
  const enabled = guideEnabled(settings);
  useEffect(() => {
    if (!entered || welcomeDone || muted || paused || !enabled || hasSession || !(route === '/' || route === '/setup' || route === '/themes' || route.startsWith('/scene/')) || !available) return;
    let active = true; const owner = `welcome:${route}`;
    queueMicrotask(() => {
      if (!active) return;
      void playGuide('guide#welcome', owner).then(async (result) => {
        if (!active || result?.status !== 'ended') return;
        if (canSaveLearning()) { await repository.completeGuideStep('welcome'); await refreshRecords(); }
        else useAppStore.setState((state) => ({ guide: advanceGuide(state.guide, 'welcome') }));
      }).catch(() => {});
    });
    return () => { active = false; audio.cancelSpeech(owner); };
  }, [route, entered, welcomeDone, muted, paused, enabled, available, storage, hasSession]);
  return null;
}
