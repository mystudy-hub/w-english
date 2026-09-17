import { ArrowRight, BookOpen, CloudDownload, Home, Leaf, LoaderCircle, LockKeyhole, School, Sprout, Sticker } from 'lucide-react';
import { useState } from 'react';
import { audio, contentThemeProgress, learningPaused, playGuide, prepareContent, readyThemeIds, sceneRoute, selectScene } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore } from '../app/store.ts';
import { themeAccess } from '../domain/themes.ts';
import { Button, GuideBubble, Header } from '../components/ui.tsx';
import { useIdleGuide } from './use-idle-guide.ts';

export function ThemeHub() {
  const state = useAppStore(); const [opening, setOpening] = useState<string>();
  const content = state.content;
  useIdleGuide('themes', { enabled: Boolean(content), ref: 'guide#choose_world', onPrompt: () => playGuide('guide#choose_world', 'themes') });
  if (!content) return null;
  const ready = readyThemeIds(); const icons = [Home, Sprout, School];
  const open = async (themeId: string) => {
    if (learningPaused()) return;
    const route = location.hash;
    void audio.unlock(); setOpening(themeId);
    try {
      const theme = content.catalog.themes.find((entry) => entry.themeId === themeId)!;
      if (!themeAccess(theme, content.catalog.themes, state.progress).unlocked) return;
      await prepareContent(themeId);
      if (location.hash !== route || learningPaused()) return;
      if (theme.unlock.prerequisiteThemeId && !readyThemeIds().has(themeId)) {
        useAppStore.setState({ notice: '新地方还在准备，先和熟悉的朋友玩一会儿吧。' }); return;
      }
      selectScene(themeId); navigate(sceneRoute(themeId));
    } finally { setOpening(undefined); }
  };
  return <><Header>
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <Button className="quiet" aria-label="典范英语1A" onClick={() => navigate('/dianfan')}><BookOpen size={16} /><span data-mode-label>典范英语1A</span></Button>
      {(content.manifest.stage ?? 0) >= 2 ? <Button className="quiet" aria-label="贴纸图鉴" onClick={() => navigate('/stickers')}><Sticker /><span data-mode-label>贴纸图鉴</span></Button> : <span className="header-chip"><Leaf size={16} /> 一起发现小小世界</span>}
    </div>
  </Header><main className="theme-hub">
    <div className="theme-heading"><div className="eyebrow">A WORLD OF LITTLE DISCOVERIES</div><h1>今天，想去哪里看看？</h1></div>
    <div className="world-grid">{content.catalog.themes.map((theme, index) => {
      const access = themeAccess(theme, content.catalog.themes, state.progress); const Icon = icons[index % icons.length]!;
      const progress = contentThemeProgress(theme.themeId); const busy = opening === theme.themeId || progress?.state === 'downloading';
      const canEnter = !theme.unlock.prerequisiteThemeId || ready.has(theme.themeId);
      return <section className={`world-card world-${index} ${access.unlocked ? '' : 'locked'}`} key={theme.themeId} data-theme-id={theme.themeId}>
        <div className="theme-world-icon"><Icon />{!access.unlocked && <LockKeyhole className="theme-lock" />}</div><h2>{theme.title.zh}</h2>
        <p>{!access.unlocked ? '新的地方，会慢慢亮起来。' : canEnter ? '朋友们正在等你来。' : '把这里的新朋友带来吧。'}</p>
        <Button className={access.unlocked ? 'primary' : 'quiet'} aria-label={access.unlocked ? `${canEnter ? '进入' : '准备'}${theme.title.zh}` : `${theme.title.zh}尚未开放`}
          disabled={!access.unlocked || busy} onClick={() => void open(theme.themeId)}>
          {busy ? <LoaderCircle className="spinning" /> : !access.unlocked ? <LockKeyhole /> : canEnter ? <ArrowRight /> : <CloudDownload />}
          <span data-mode-label>{busy ? '准备中…' : !access.unlocked ? '慢慢发现' : canEnter ? '去看看' : '准备新朋友'}</span>
        </Button>
      </section>;
    })}
    <section className="world-card world-dianfan" style={{ gridColumn: '1 / -1', background: 'linear-gradient(135deg, #fffdf8 0%, #fff4e5 100%)', border: '2px solid #fbd38d', borderRadius: '1.5rem', padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '2.5rem' }}>📚</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#78350f', fontWeight: 800 }}>典范英语 1A · 42 课同步词汇天地</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#92400e', fontSize: '0.875rem' }}>牛津阅读树原版 42 篇小故事，245 个分课核心词汇、例句与闯关小练习</p>
          </div>
        </div>
        <Button className="primary" onClick={() => navigate('/dianfan')}>
          <ArrowRight />
          <span data-mode-label>进入专区</span>
        </Button>
      </div>
    </section>
    </div><GuideBubble>从亮起来的地方开始，一次认识一点点。</GuideBubble>
  </main></>;
}
