import { Component, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { boot, audio, leaveExperience, playEffect } from './runtime.ts';
import { useRoute } from './router.ts';
import { useAppStore, useSettings } from './store.ts';
import { reducedMotion } from '../domain/config.ts';
import { Welcome } from '../features/welcome.tsx';
import { Setup } from '../features/setup.tsx';
import { Scene } from '../features/scene.tsx';
import { WordCard } from '../features/word-card.tsx';
import { ParentPage } from '../features/parent.tsx';
import { Lesson, RoundEnd } from '../features/lesson.tsx';
import { GuideLifecycle } from '../features/guide-lifecycle.tsx';
import { StorageRecovery } from '../features/storage-recovery.tsx';
import { ThemeHub } from '../features/theme-hub.tsx';
import { Phonics } from '../features/phonics.tsx';
import { Spelling } from '../features/spelling.tsx';
import { StickerBook } from '../features/stickers.tsx';
import { RestDialog, UsageLifecycle } from '../features/rest.tsx';
import { shouldShowRest } from '../domain/usage.ts';
import { Button } from '../components/ui.tsx';
import { OrientationDialog } from '../features/orientation.tsx';

function App() {
  const route = useRoute(); const state = useAppStore(); const settings = useSettings();
  const surface = useRef<HTMLDivElement>(null);
  const [systemMotion, setSystemMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [viewportReady, setViewportReady] = useState(() => innerWidth >= 960 && innerHeight >= 600 && innerWidth > innerHeight);
  useEffect(() => { void boot(); }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'); const changed = () => setSystemMotion(query.matches);
    query.addEventListener('change', changed); return () => query.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    const resize = () => {
      const style = surface.current ? getComputedStyle(surface.current) : undefined;
      const width = innerWidth - parseFloat(style?.paddingLeft ?? '0') - parseFloat(style?.paddingRight ?? '0');
      const height = innerHeight - parseFloat(style?.paddingTop ?? '0') - parseFloat(style?.paddingBottom ?? '0');
      setViewportReady(width >= 960 && height >= 600 && width > height);
    };
    resize();
    addEventListener('resize', resize); return () => removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) audio.cancel(); };
    document.addEventListener('visibilitychange', hidden); return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  useEffect(() => {
    const devices = navigator.mediaDevices; const changed = () => audio.outputDeviceChanged();
    devices?.addEventListener('devicechange', changed);
    return () => devices?.removeEventListener('devicechange', changed);
  }, []);
  useEffect(() => { audio.cancelSpeech(); if (route === '/') leaveExperience(); }, [route]);
  useEffect(() => {
    addEventListener('pagehide', leaveExperience);
    return () => { removeEventListener('pagehide', leaveExperience); leaveExperience(); };
  }, []);
  useEffect(() => {
    const clicked = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || button.disabled || button.dataset.sfx === 'none' || audio.isMuted) return;
      void audio.unlock().then((unlocked) => { if (unlocked) void playEffect('sfx#pop'); });
    };
    document.addEventListener('click', clicked, true);
    return () => document.removeEventListener('click', clicked, true);
  }, []);
  const motion = reducedMotion(settings, systemMotion);
  const mode = route.startsWith('/play/') && state.session?.status === 'active'
    ? state.session.configSnapshot.interactionMode : settings.interactionMode;
  const childPage = state.entered && state.phase === 'ready' && state.onboardingComplete && route !== '/setup' && !(route === '/parent' && state.parentAuthorized);
  const parentPage = state.entered && ((route === '/parent' && state.parentAuthorized) || !state.onboardingComplete || route === '/setup');
  const stage2 = (state.content?.manifest.stage ?? 0) >= 2;
  const answering = route.startsWith('/play/') && state.session?.status === 'active';
  const questionId = answering ? state.session?.questions[state.session.currentQuestionIndex]?.id : undefined;
  const restVisible = stage2 && childPage && shouldShowRest(state.usage, answering, questionId);
  useLayoutEffect(() => {
    const paused = restVisible || !viewportReady;
    useAppStore.setState({ interactionPaused: paused });
    if (paused) audio.cancel();
  }, [restVisible, viewportReady]);
  let page: ReactNode;
  if (!state.entered || (state.phase !== 'ready' && route !== '/parent')) page = <Welcome requestedRoute={route} />;
  else if (route === '/parent' && state.parentAuthorized) page = state.storage === 'pending' ? <StorageRecovery /> : <ParentPage />;
  else if (!state.onboardingComplete || route === '/setup') page = <Setup />;
  else if (route === '/stickers' && (state.content?.manifest.stage ?? 0) >= 2) page = <StickerBook />;
  else if (route.startsWith('/word/')) page = <WordCard key={route} wordId={route.slice('/word/'.length)} />;
  else if (route.startsWith('/phonics/')) page = <Phonics key={route} wordId={route.slice('/phonics/'.length)} />;
  else if (route.startsWith('/play/spell/')) page = <Spelling viewportReady={viewportReady && !restVisible} />;
  else if (route.startsWith('/play/listen/')) page = <Lesson viewportReady={viewportReady && !restVisible} />;
  else if (/^\/session\/.+\/end$/.test(route)) page = <RoundEnd sessionId={route.split('/')[2]!} paused={restVisible || !viewportReady} />;
  else if (route === '/themes' || (!route.startsWith('/scene/') && (state.content?.catalog.themes.length ?? 0) > 1)) page = <ThemeHub />;
  else page = <Scene key={route} themeId={route.startsWith('/scene/') ? route.split('/')[2]! : state.sceneThemeId} />;
  return <div ref={surface} className={`app mode-${mode} ${motion ? 'motion-reduced' : ''}`} data-audience={parentPage ? 'parent' : 'child'}>
    {page}
    <UsageLifecycle enabled={stage2 && state.entered} active={childPage && viewportReady && !restVisible} questionId={questionId} limitMinutes={settings.parentSettings.screenTimeMinutes} />
    {restVisible && <RestDialog />}
    <GuideLifecycle route={route} />
    {state.notice && <div className="app-notice" role="status"><span>{state.notice}</span><button aria-label="关闭提示" onClick={() => useAppStore.setState({ notice: undefined })}><X size={18} /></button></div>}
    {!viewportReady && route !== '/parent' && !restVisible && <OrientationDialog />}
  </div>;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { audio.cancel(); }
  render() {
    if (this.state.failed) return <main className="empty-page"><h1>小小世界需要重新整理一下</h1><p>学习记录会保留，我们再打开一次吧。</p><Button onClick={() => location.reload()}><RotateCcw />重新打开</Button></main>;
    return this.props.children;
  }
}
export default App;
