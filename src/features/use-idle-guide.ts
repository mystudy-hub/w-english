import { useEffect, useRef } from 'react';
import { audio, learningPaused } from '../app/runtime.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { guideEnabled } from '../domain/config.ts';
import { IdleGuideClock } from '../domain/idle-guide.ts';
import type { InteractionMode } from '../domain/models.ts';

export function useIdleGuide(owner: string, options: { enabled: boolean; onPrompt: () => Promise<unknown>; count?: number; lastPrompt?: number; ref?: string; mode?: InteractionMode }) {
  const settings = useSettings(); const muted = useAppStore((state) => state.muted);
  const paused = useAppStore((state) => state.interactionPaused);
  const enabled = options.enabled && guideEnabled({ ...settings, interactionMode: options.mode ?? settings.interactionMode }) && !muted && !paused;
  const latest = useRef({ ...options, enabled });
  useEffect(() => { latest.current = { ...options, enabled }; }, [options, enabled]);
  useEffect(() => {
    const clock = new IdleGuideClock(Date.now(), latest.current.count, latest.current.lastPrompt);
    let active = true; let pending = false;
    const activity = () => clock.activity(Date.now());
    const tick = () => {
      const current = latest.current;
      clock.sync(current.count ?? 0, current.lastPrompt);
      const eligible = current.enabled && !learningPaused() && !document.hidden && !audio.playing && audio.has(current.ref ?? 'guide#idle') && !pending;
      if (!clock.due(Date.now(), eligible)) return;
      clock.reserve(Date.now()); pending = true;
      useAppStore.setState((state) => ({ guidePulse: state.guidePulse + 1 }));
      void current.onPrompt().catch(() => {}).finally(() => { if (active) pending = false; });
    };
    const interval = setInterval(tick, 250);
    document.addEventListener('pointerdown', activity, true); document.addEventListener('keydown', activity, true);
    document.addEventListener('visibilitychange', activity);
    return () => {
      active = false; clearInterval(interval); audio.cancelSpeech(owner);
      document.removeEventListener('pointerdown', activity, true); document.removeEventListener('keydown', activity, true);
      document.removeEventListener('visibilitychange', activity);
    };
  }, [owner]);
}
