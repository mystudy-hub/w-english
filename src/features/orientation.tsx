import { Smartphone, Volume2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { audio, playGuide } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';
import { Button, ParentGate } from '../components/ui.tsx';
import { CORE_GUIDE_SPRITE } from '../domain/guide-content.ts';

export function OrientationDialog() {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  const entered = useAppStore((state) => state.entered); const muted = useAppStore((state) => state.muted);
  useAppStore((state) => state.audioRevision);
  const ref = `${CORE_GUIDE_SPRITE}#rotate`; const available = audio.has(ref);
  useLayoutEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); audio.cancelSpeech('orientation'); }; }, []);
  useEffect(() => {
    if (entered && available && !muted && dialog.current?.open) void playGuide(ref, 'orientation');
    return () => audio.cancelSpeech('orientation');
  }, [entered, available, muted, ref]);
  const speak = async () => {
    const unlocked = await audio.unlock();
    if (unlocked && dialog.current?.open) { audio.cancelSpeech('orientation'); await playGuide(ref, 'orientation'); }
  };
  return <dialog ref={dialog} className="orientation-overlay" aria-labelledby={titleId} onCancel={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter((button) => button.getClientRects().length);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }}>
    <div className="orientation-parent"><ParentGate /></div><Smartphone aria-hidden="true" /><h1 id={titleId}>把小小世界横过来</h1>
    <p>请使用平板或电脑横屏，给小伙伴们多一点空间。</p>
    {available && <Button aria-label="听横屏提示" disabled={muted} onClick={() => void speak()}><Volume2 /><span data-mode-label>听听提示</span></Button>}
  </dialog>;
}
