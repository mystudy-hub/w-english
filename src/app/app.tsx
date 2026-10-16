import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
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

// 典范专区（含 42 课时间轴，约 160 KB 生成数据）与课本轨道按路由懒加载：
// 只玩 explore 的孩子不必为它们付费。这些 chunk 仍进 Service Worker 预缓存（globPatterns 含 **/*.js），离线可用。
const DianfanPage = lazy(() => import('../features/dianfan.tsx'));
const DrillHome = lazy(() => import('../drill/drill-home.tsx').then((module) => ({ default: module.DrillHome })));
const DrillSession = lazy(() => import('../drill/session.tsx').then((module) => ({ default: module.DrillSession })));
const DrillReport = lazy(() => import('../drill/report.tsx').then((module) => ({ default: module.DrillReport })));

// 设计基准：平板横屏 960×600。可用区域小于它时不再要求旋转，而是整体等比缩小
// （手机横屏常见 844×390 / 740×360）；小于下面的下限才继续提示横过来。
const DESIGN_WIDTH = 960; const DESIGN_HEIGHT = 600;
const MIN_WIDTH = 640; const MIN_HEIGHT = 320;

function App() {
  const route = useRoute(); const state = useAppStore(); const settings = useSettings();
  const surface = useRef<HTMLDivElement>(null);
  const [systemMotion, setSystemMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [usable, setUsable] = useState(() => ({ width: innerWidth, height: innerHeight }));
  useEffect(() => { void boot(); }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'); const changed = () => setSystemMotion(query.matches);
    query.addEventListener('change', changed); return () => query.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    const resize = () => {
      const style = surface.current ? getComputedStyle(surface.current) : undefined;
      setUsable({
        width: innerWidth - parseFloat(style?.paddingLeft ?? '0') - parseFloat(style?.paddingRight ?? '0'),
        height: innerHeight - parseFloat(style?.paddingTop ?? '0') - parseFloat(style?.paddingBottom ?? '0'),
      });
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
  const isFreePlay = Boolean(settings.parentSettings.freePlayMode);
  // 竖屏（高度大于宽度）提示横过来；横屏但小到连缩放都不够也提示。
  const viewportReady = usable.width > usable.height && usable.width >= MIN_WIDTH && usable.height >= MIN_HEIGHT;
  // 等比缩放到设计基准内：只在需要时缩小，从不放大。
  // 这些是「长列表/长表单 + 滚动」的浏览页（典范专区还用 Tailwind 响应式分栏）：缩放会让它们
  // 变成窄栏堆叠或过小的表单文字，所以保持真实尺寸、照常滚动。
  const scrollingPage = route.startsWith('/dianfan') || route === '/drill/report' || route === '/parent';
  const fitScale = viewportReady && !scrollingPage
    ? Math.min(1, Math.round(Math.min(usable.width / DESIGN_WIDTH, usable.height / DESIGN_HEIGHT) * 1000) / 1000)
    : 1;
  const effectiveViewportReady = isFreePlay || state.viewportBypass || viewportReady;
  const mode = route.startsWith('/play/') && state.session?.status === 'active'
    ? state.session.configSnapshot.interactionMode : settings.interactionMode;
  const childPage = state.entered && state.phase === 'ready' && state.onboardingComplete && route !== '/setup' && !(route === '/parent' && state.parentAuthorized);
  const parentPage = state.entered && ((route === '/parent' && state.parentAuthorized) || !state.onboardingComplete || route === '/setup');
  const stage2 = (state.content?.manifest.stage ?? 0) >= 2;
  const answering = route.startsWith('/play/') && state.session?.status === 'active';
  const questionId = answering ? state.session?.questions[state.session.currentQuestionIndex]?.id : undefined;
  const restVisible = !isFreePlay && settings.parentSettings.screenTimeMinutes !== 0 && stage2 && childPage && shouldShowRest(state.usage, answering, questionId);
  useLayoutEffect(() => {
    const paused = restVisible || !effectiveViewportReady;
    useAppStore.setState({ interactionPaused: paused });
    if (paused) audio.cancel();
  }, [restVisible, effectiveViewportReady]);
  let page: ReactNode;
  if (!state.entered || (state.phase !== 'ready' && route !== '/parent')) page = <Welcome requestedRoute={route} />;
  else if (route === '/parent' && state.parentAuthorized) page = state.storage === 'pending' ? <StorageRecovery /> : <ParentPage />;
  else if (!state.onboardingComplete || route === '/setup') page = <Setup />;
  else if (route === '/drill') page = <DrillHome />;
  else if (route === '/drill/session') page = <DrillSession />;
  else if (route === '/drill/report') page = <DrillReport />;
  else if (route === '/stickers' && (state.content?.manifest.stage ?? 0) >= 2) page = <StickerBook />;
  else if (route.startsWith('/dianfan')) page = <DianfanPage />;
  else if (route.startsWith('/word/')) page = <WordCard key={route} wordId={route.slice('/word/'.length)} />;
  else if (route.startsWith('/phonics/')) page = <Phonics key={route} wordId={route.slice('/phonics/'.length)} />;
  else if (route.startsWith('/play/spell/')) page = <Spelling viewportReady={effectiveViewportReady && !restVisible} />;
  else if (route.startsWith('/play/listen/')) page = <Lesson viewportReady={effectiveViewportReady && !restVisible} />;
  else if (/^\/session\/.+\/end$/.test(route)) page = <RoundEnd sessionId={route.split('/')[2]!} paused={restVisible || !effectiveViewportReady} />;
  else if (route === '/themes' || (!route.startsWith('/scene/') && (state.content?.catalog.themes.length ?? 0) > 1)) page = <ThemeHub />;
  else page = <Scene key={route} themeId={route.startsWith('/scene/') ? route.split('/')[2]! : state.sceneThemeId} />;
  return <div ref={surface} className={`app mode-${mode} ${motion ? 'motion-reduced' : ''}`} data-audience={parentPage ? 'parent' : 'child'}
    style={{ '--fit-scale': String(fitScale) } as CSSProperties}>
    <Suspense fallback={<main className="empty-page" role="status"><h1>正在打开，请稍等…</h1></main>}>{page}</Suspense>
    <UsageLifecycle enabled={!isFreePlay && settings.parentSettings.screenTimeMinutes !== 0 && stage2 && state.entered} active={childPage && effectiveViewportReady && !restVisible} questionId={questionId} limitMinutes={settings.parentSettings.screenTimeMinutes} />
    {restVisible && <RestDialog />}
    <GuideLifecycle route={route} />
    {state.notice && <div className="app-notice" role="status"><span>{state.notice}</span><button aria-label="关闭提示" onClick={() => useAppStore.setState({ notice: undefined })}><X size={18} /></button></div>}
    {!effectiveViewportReady && route !== '/parent' && !restVisible && <OrientationDialog onBypass={() => {
      useAppStore.setState({ viewportBypass: true });
      if (typeof window !== 'undefined') localStorage.setItem('viewport_bypass', 'true');
    }} />}
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
