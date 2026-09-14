import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft, LoaderCircle, LockKeyhole, Volume2, VolumeX } from 'lucide-react';
import type { WordEntry } from '../data/content-schema.ts';
import { assetUrl, audio, enterExperience, leaveExperience } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { guideEnabled } from '../domain/config.ts';
import type { InteractionMode } from '../domain/models.ts';

export function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`button ${className}`} {...props}>{children}</button>;
}
export function IconButton({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Button aria-label={label} title={label} className="icon-button" {...props}>{children}</Button>;
}
export function Ollie({ className = '', decorative = true }: { className?: string; decorative?: boolean }) {
  return <img className={`ollie ${className}`} src={assetUrl('icons/ollie.svg')} alt={decorative ? '' : '向导 Ollie'} draggable={false} />;
}
export function WordImage({ word, className = '' }: { word: WordEntry; className?: string }) {
  const content = useAppStore((state) => state.content);
  const [failed, setFailed] = useState(false);
  const asset = word.illustration.type === 'image' ? content?.manifest.assets[word.illustration.src] : undefined;
  const available = word.illustration.type === 'image' && content?.verifiedIds.has(word.illustration.src);
  useEffect(() => { setFailed(false); }, [asset?.url, available]);
  if (!asset || !available || failed) return <span className={`image-wait ${className}`} role="img" aria-label={`${word.word} 的图片正在准备`}><LoaderCircle aria-hidden="true" /></span>;
  return <img className={`word-image ${className}`} src={assetUrl(asset.url)} alt={word.illustration.type === 'image' ? word.illustration.alt : word.word} draggable={false} onError={() => setFailed(true)} />;
}
export function ParentGate() {
  const descriptionId = useId();
  const started = useRef<number | null>(null);
  const frame = useRef<number>(0);
  const [progress, setProgress] = useState(0);
  const cancel = () => { started.current = null; cancelAnimationFrame(frame.current); setProgress(0); };
  const start = () => {
    if (started.current !== null) return;
    started.current = performance.now();
    const tick = () => {
      if (started.current === null) return;
      const value = Math.min(1, (performance.now() - started.current) / 3000);
      setProgress(value);
      if (value >= 1) {
        started.current = null;
        void enterExperience(true).then((entered) => {
          if (entered) { useAppStore.setState({ parentAuthorized: true }); navigate('/parent'); }
        });
        setProgress(0);
      } else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return <div className="parent-gate-wrap">
    <button type="button" className="parent-gate" data-sfx="none" aria-label="家长设置，按住三秒" aria-describedby={descriptionId}
      onPointerDown={(event) => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); start(); } }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onBlur={cancel}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
      }}
      onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) start(); } }}
      onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); cancel(); } }}
      onContextMenu={(event) => event.preventDefault()}>
      <svg viewBox="0 0 44 44" className="gate-progress" aria-hidden="true"><circle cx="22" cy="22" r="19" pathLength="1" strokeDasharray={`${progress} 1`} /></svg>
      <LockKeyhole size={19} aria-hidden="true" /><span>家长专区</span>
    </button>
    <span className="gate-hint" id={descriptionId}>{progress > 0 ? '继续按住…' : '长按 3 秒'}</span>
  </div>;
}
export function Header({ back, children }: { back?: () => void; children?: ReactNode }) {
  const muted = useAppStore((state) => state.muted);
  return <header className="app-header">
    <div className="header-start">
      {back ? <IconButton label="返回" onClick={back}><ArrowLeft /></IconButton> : <Ollie className="brand-owl" />}
      <a className="brand" href="#/" onClick={(event) => { event.preventDefault(); leaveExperience(); navigate('/'); }}>
        <span>W<span className="brand-dash">—</span>English</span><small>小小好奇心，大大的世界</small>
      </a>
    </div>
    <div className="header-middle">{children}</div>
    <div className="header-end"><IconButton label={muted ? '打开声音' : '静音'} onClick={() => { audio.setMuted(!muted); useAppStore.setState({ muted: !muted }); }}>{muted ? <VolumeX /> : <Volume2 />}</IconButton><ParentGate /></div>
  </header>;
}
export function GuideBubble({ children, essential = false, mode }: { children: ReactNode; essential?: boolean; mode?: InteractionMode }) {
  const settings = useSettings(); const pulse = useAppStore((state) => state.guidePulse);
  const enabled = guideEnabled({ ...settings, interactionMode: mode ?? settings.interactionMode });
  return <div className={`guide-bubble ${!enabled && !essential ? 'guide-quiet' : ''}`}><Ollie key={pulse} className={pulse > 0 && enabled ? 'guide-nudge' : ''} /><div>{children}</div></div>;
}
