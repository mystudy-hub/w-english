import { ArrowLeft, ArrowRight, BookOpen, Headphones, Leaf, RotateCcw, Star, TrainFront, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { audio, beginSession, playGuide, prepareContent, readySpellingWordIds, readyThemeIds, readyWordIds, selectScene, sessionRoute } from '../app/runtime.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { LEVELS } from '../domain/config.ts';
import { isReviewDue } from '../domain/learning.ts';
import { Button, GuideBubble, Header, IconButton, WordImage } from '../components/ui.tsx';
import { useIdleGuide } from './use-idle-guide.ts';
import { themeAccess } from '../domain/themes.ts';
import { ThemeHub } from './theme-hub.tsx';

export function Scene({ themeId }: { themeId: string }) {
  const state = useAppStore(); const settings = useSettings(); const [starting, setStarting] = useState(false);
  const content = state.content;
  const theme = content?.catalog.themes.find((entry) => entry.themeId === themeId);
  const permitted = Boolean(theme && content && themeAccess(theme, content.catalog.themes, state.progress).unlocked
    && (!theme.unlock.prerequisiteThemeId || readyThemeIds().has(themeId)));
  useEffect(() => {
    if (permitted && useAppStore.getState().sceneThemeId !== themeId) { selectScene(themeId); void prepareContent(themeId); }
    if (permitted && theme?.spriteIds?.length) { void audio.preload(theme.spriteIds); }
  }, [themeId, permitted, theme]);
  useIdleGuide(`scene:${themeId}`, { enabled: permitted, ref: 'guide#explore', onPrompt: () => playGuide('guide#explore', `scene:${themeId}`) });
  if (!content) return null;
  if (!theme || !permitted) return <ThemeHub />;
  const page = Math.min(state.scenePage, theme.pages.length - 1);
  const words = theme.pages[page]!.map((id) => content.catalog.words.find((word) => word.wordId === id)!);
  const ready = readyWordIds();
  const available = state.learningAccess === 'writer' && state.session?.activity !== 'tapSpell' && theme.listenTapWordIds.filter((id) => ready.has(id)).length >= LEVELS[settings.learningLevel].optionCount;
  const spellingReady = readySpellingWordIds();
  const canSpell = state.learningAccess === 'writer' && (!state.session || state.session.activity === 'tapSpell')
    && content.catalog.words.some((word) => theme.wordIds.includes(word.wordId) && spellingReady.has(word.wordId) && word.track === 'phonics' && word.phonicsStage <= LEVELS[settings.learningLevel].phonicsStage);
  const due = state.progress.filter((entry) => theme.listenTapWordIds.includes(entry.wordId) && isReviewDue(entry, Date.now())).length;
  const start = async (reviewOnly = false, activity: 'listenTap' | 'tapSpell' = 'listenTap') => {
    void audio.unlock(); setStarting(true);
    try { const session = await beginSession(reviewOnly, theme.themeId, activity); if (session) navigate(sessionRoute(session)); }
    catch { useAppStore.setState({ notice: '这一轮还没准备好，先认识一位朋友吧。' }); }
    finally { setStarting(false); }
  };
  return <><Header back={content.catalog.themes.length > 1 ? () => navigate('/themes') : undefined}>
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <Button className="quiet" aria-label="典范英语1A" onClick={() => navigate('/dianfan')}><BookOpen size={16} /><span data-mode-label>典范英语1A</span></Button>
      <span className="header-chip"><Leaf size={16} /> 我的探索时光</span>
    </div>
  </Header><main className="scene-page">
    <div className="scene-title"><div><div className="eyebrow">OUR LITTLE WORLD</div><h1>{theme.title.zh}<span className="tiny-flower">✿</span></h1><p>这里住着好多有趣的小伙伴，点一点，打个招呼吧。</p></div><div className="discovery-count"><Star /><strong>{state.progress.filter((entry) => theme.wordIds.includes(entry.wordId) && entry.exploredAt !== undefined).length}</strong><span>个小发现</span></div></div>
    <div className="scene-board"><div className="board-cloud cloud-a" /><div className="board-cloud cloud-b" /><div className="board-hill" />
      <div className="word-grid">{words.map((word, index) => {
        const progress = state.progress.find((entry) => entry.wordId === word.wordId);
        return <button key={word.wordId} className={`word-tile tile-${index % 5}`} aria-label={`认识${word.illustration.type === 'image' ? word.illustration.alt : word.word}`} onClick={() => navigate(`/word/${word.wordId}`)}>
          <span className="tile-dot">{progress?.heardCount ? <Volume2 size={15} /> : '✦'}</span><WordImage word={word} />
          <span className="tile-name" data-mode-label>{word.word}</span><span className="tile-pedestal" />
        </button>;
      })}</div>
      <div className="scene-pagination"><IconButton label="上一页" disabled={page === 0} onClick={() => useAppStore.setState({ scenePage: page - 1 })}><ArrowLeft /></IconButton><div className="page-dots">{theme.pages.map((_, index) => <span key={index} className={index === page ? 'active' : ''} />)}</div><IconButton label="下一页" disabled={page === theme.pages.length - 1} onClick={() => useAppStore.setState({ scenePage: page + 1 })}><ArrowRight /></IconButton></div>
    </div>
    <div className="scene-actions"><GuideBubble>小小的发现，也值得开心一下。<span>选一个你喜欢的朋友吧！</span></GuideBubble><div className="button-row">{due > 0 && <Button onClick={() => void start(true)} disabled={!available || starting}><RotateCcw /><span data-mode-label>再见老朋友</span></Button>}{(content.manifest.stage ?? 0) >= 2 && <Button className="soft-gold" aria-label="拼字母" disabled={!canSpell || starting} onClick={() => void start(false, 'tapSpell')}><TrainFront /><span data-mode-label>{state.session?.activity === 'tapSpell' ? '继续拼字母' : '字母小火车'}</span></Button>}<Button className="primary" disabled={!available || starting} onClick={() => void start()} title={available ? '听音选图' : '声音准备好后，就可以开始听音游戏'} aria-label="听音选图"><Headphones /><span data-mode-label>{starting ? '准备中…' : state.session ? '继续这一轮' : '听一听，找一找'}</span></Button></div></div>
  </main></>;
}
