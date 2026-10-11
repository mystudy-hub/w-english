import { ArrowRight, Smartphone, Volume2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { audio, playGuide } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';
import { Button, ParentGate } from '../components/ui.tsx';
import { CORE_GUIDE_SPRITE } from '../domain/guide-content.ts';

export function OrientationDialog({ onBypass }: { onBypass?: () => void }) {
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
  const handleBypass = () => {
    dialog.current?.close();
    onBypass?.();
  };
  return <dialog ref={dialog} className="orientation-overlay" aria-labelledby={titleId}
    onCancel={() => { handleBypass(); }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleBypass();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter((button) => button.getClientRects().length);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }}>
    <div className="orientation-parent"><ParentGate /></div><Smartphone aria-hidden="true" /><h1 id={titleId}>把小小世界横过来</h1>
    <p>平板或电脑横屏能获得最佳视觉体验。如果你在手机或小窗口使用，也可以直接进入。</p>
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
      {available && <Button aria-label="听横屏提示" disabled={muted} onClick={() => void speak()}><Volume2 /><span data-mode-label>听听提示</span></Button>}
      <Button className="primary" aria-label="在此屏幕继续" onClick={handleBypass}>
        <ArrowRight />
        <span data-mode-label>自由模式 · 在此屏幕继续</span>
      </Button>
    </div>
  </dialog>;
}
