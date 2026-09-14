import { ArrowRight, Compass, Headphones, Leaf, MousePointer2, RefreshCw, Sparkles, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { audio, boot, enterExperience, explorationRoute, playGuide, sessionRoute } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore } from '../app/store.ts';
import { Button, Header, Ollie } from '../components/ui.tsx';

export function Welcome({ requestedRoute }: { requestedRoute: string }) {
  const state = useAppStore();
  const [online, setOnline] = useState(() => navigator.onLine);
  const offline = state.phase === 'failed' && state.storage !== 'pending' && !online;
  const offlineGuide = offline && audio.has('guide#offline');
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update); addEventListener('offline', update);
    return () => { removeEventListener('online', update); removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (offlineGuide) void playGuide('guide#offline', 'offline');
    return () => audio.cancelSpeech('offline');
  }, [offlineGuide]);
  const hearOfflineHelp = async () => {
    audio.cancelSpeech('offline');
    if (await audio.unlock() && !navigator.onLine && useAppStore.getState().phase === 'failed') await playGuide('guide#offline', 'offline');
  };
  const begin = async () => {
    // This must stay before any async storage or network work.
    void audio.unlock();
    if (!await enterExperience()) return;
    const fresh = useAppStore.getState();
    if (!fresh.onboardingComplete) navigate('/setup');
    else if (fresh.session) navigate(sessionRoute(fresh.session));
    else navigate(requestedRoute.startsWith('/word/') ? requestedRoute : explorationRoute());
  };
  return <div className="welcome-page"><Header />
    <main className="welcome-main">
      <section className="welcome-copy">
        <div className="eyebrow"><Leaf size={16} /> 给好奇的小小探索家</div>
        <h1>每一个新词，<br />都是一个<span className="underlined">新朋友</span>。</h1>
        <p className="welcome-description">听一听，点一点。和 Ollie 一起，<br />走进英语里的小小世界。</p>
        <div className="welcome-steps"><span><Headphones />听一听</span><i /><span><MousePointer2 />点一点</span><i /><span><Sparkles />发现新朋友</span></div>
        {state.phase === 'failed' ? <div className="welcome-error" role="status"><p>{state.storage === 'pending' ? '学习记录暂时打不开。请家长帮忙再试一次，也可以先体验小小世界。' : offline ? '先连上网，把小伙伴们带来，再一起出发吧。' : '小小世界暂时打不开，请家长帮忙再试一次。'}</p><div className="button-row"><Button onClick={() => void boot(false, true)}><RefreshCw /> 再试一次</Button>{offlineGuide && <Button aria-label="听离线提示" onClick={() => void hearOfflineHelp()}><Volume2 /><span data-mode-label>听听提示</span></Button>}{state.storage === 'pending' && <Button onClick={() => void boot(true, true)}>临时体验</Button>}</div></div>
          : <Button className="primary adventure-button" disabled={state.phase !== 'ready' || state.entering} onClick={() => void begin()}>{state.phase === 'loading' || state.entering ? '正在准备小小世界…' : '开始冒险'}<ArrowRight /></Button>}
        <p className="small-note">按自己的节奏，每次一点点就很好。</p>
      </section>
      <section className="welcome-art" aria-label="Ollie 正在等你一起探索">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="art-sun"><span /></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span>
        <div className="floating-card hello-card"><span>Hello!</span><small>很高兴认识你</small></div>
        <div className="owl-platform"><Ollie className="hero-owl" /><div className="platform-shadow" /></div>
        <div className="floating-card adventure-card"><Compass /><div>我们的第一站<small>动物之家</small></div></div>
        <div className="art-leaf leaf-one" /><div className="art-leaf leaf-two" /><div className="art-leaf leaf-three" />
      </section>
    </main>
    <footer className="welcome-footer"><span className="footer-sprout">✿</span> 在小小的发现里，慢慢长大。<span className="footer-dots">· · ·</span></footer>
  </div>;
}
