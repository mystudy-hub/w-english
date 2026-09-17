import { ArrowLeft, BookOpen, Bubbles, Headphones, LoaderCircle, TrainFront, Turtle, Users, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { audio, beginSession, discover, explorationRoute, learningPaused, playGuide, playWord, readySpellingWordIds, readyThemeIds, sceneRoute, selectScene, sessionRoute } from '../app/runtime.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { LEVELS } from '../domain/config.ts';
import { Button, Header, WordImage } from '../components/ui.tsx';
import { useIdleGuide } from './use-idle-guide.ts';
import { themeAccess } from '../domain/themes.ts';
import { graphemeKind } from '../domain/spelling.ts';

export function WordCard({ wordId }: { wordId: string }) {
  const content = useAppStore((state) => state.content); const settings = useSettings();
  const word = content?.catalog.words.find((entry) => entry.wordId === wordId);
  const progress = useAppStore((state) => state.progress);
  const learningAccess = useAppStore((state) => state.learningAccess); const session = useAppStore((state) => state.session);
  const paused = useAppStore((state) => state.interactionPaused);
  const theme = content?.catalog.themes.find((entry) => entry.wordIds.includes(wordId));
  const permitted = Boolean(word && theme && content && themeAccess(theme, content.catalog.themes, progress).unlocked
    && (!theme.unlock.prerequisiteThemeId || readyThemeIds().has(theme.themeId)));
  const [parentOpen, setParentOpen] = useState(false); const [playing, setPlaying] = useState<string>(); const [message, setMessage] = useState('');
  const owner = `word:${wordId}`;
  useIdleGuide(owner, { enabled: permitted && !parentOpen, onPrompt: () => playGuide('guide#idle', owner) });
  useEffect(() => { if (permitted && !paused) void discover(wordId); return () => audio.cancel(owner); }, [wordId, owner, permitted, paused]);
  useEffect(() => {
    if (word?.audio.word) {
      const [spriteId] = word.audio.word.split('#');
      if (spriteId) void audio.preload([spriteId]);
    }
  }, [word]);
  if (!word || !theme || !permitted) return <><Header back={() => navigate(explorationRoute())} /><main className="empty-page"><h1>先从亮起来的地方开始吧</h1><Button onClick={() => navigate(explorationRoute())}><ArrowLeft />回到小小世界</Button></main></>;
  const back = () => { selectScene(theme.themeId); useAppStore.setState({ scenePage: Math.max(0, theme.pages.findIndex((page) => page.includes(wordId))) }); navigate(sceneRoute(theme.themeId)); };
  const play = async (ref: string, countHeard: boolean) => {
    if (learningPaused() || Boolean(playing)) return;
    setMessage(''); setPlaying(ref);
    try {
      const result = await playWord(ref, wordId, owner, countHeard);
      if (result.status === 'failed') {
        setMessage(audio.isMuted ? '先打开右上角的声音，再听一听。' : '再点一下小喇叭试试吧。');
        if (location.hash === `#/word/${wordId}`) void playGuide('guide#audio_retry', owner);
      }
    } finally {
      setPlaying(undefined);
    }
  };
  const hasAudio = audio.has(word.audio.word);
  const canPhonics = word.track === 'phonics' && word.phonicsStage <= LEVELS[settings.learningLevel].phonicsStage;
  const stage2 = (content?.manifest.stage ?? 0) >= 2;
  const spell = async () => {
    void audio.unlock();
    try { const started = await beginSession(false, theme.themeId, 'tapSpell', wordId); if (started) navigate(sessionRoute(started)); }
    catch { setMessage('字母小火车还没有准备好，请再试一次。'); }
  };
  return <><Header back={back}><span className="header-chip"><BookOpen size={16} /> 认识一个新朋友</span></Header><main className={`word-page ${parentOpen ? 'with-parent' : ''}`}>
    <section className="word-card-surface"><div className="word-portrait"><span className="portrait-circle" /><WordImage word={word} /><span className="portrait-spark">✧</span></div>
      <div className="word-details"><span className="word-eyebrow">HELLO, LITTLE FRIEND</span><h1>{word.word}</h1><p className="word-definition">{word.definition[LEVELS[settings.learningLevel].definition]}</p>
        <div className="audio-controls">
          <Button className="primary" data-sfx="none" disabled={!hasAudio} onClick={() => void play(word.audio.word, true)} aria-label="听单词">{playing === word.audio.word ? <LoaderCircle className="spinning" /> : <Volume2 />}<span data-mode-label>听一听</span></Button>
          <Button className="soft-gold" data-sfx="none" disabled={!audio.has(word.audio.wordSlow)} onClick={() => void play(word.audio.wordSlow, true)} aria-label="慢慢听"><Turtle /><span data-mode-label>慢慢听</span></Button>
          <Button className="soft-blue" data-sfx="none" disabled={!audio.has(word.example.audio)} onClick={() => void play(word.example.audio, false)} aria-label="听例句"><Headphones /><span data-mode-label>听句子</span></Button>
        </div>
        {canPhonics && (stage2 ? <div className="word-activities"><Button className="soft-blue" aria-label="拼读泡泡" onClick={() => navigate(`/phonics/${wordId}`)}><Bubbles /><span data-mode-label>拼读泡泡</span></Button><Button className="soft-gold" aria-label="拼这个单词" disabled={learningAccess !== 'writer' || !readySpellingWordIds().has(wordId) || Boolean(session && session.activity !== 'tapSpell')} onClick={() => void spell()}><TrainFront /><span data-mode-label>字母小火车</span></Button></div>
          : <div className="phonics-row" aria-label="拼读声音">{word.graphemes.map((part, index) => <button key={`${part.letters}-${index}`} className={`phonics-bubble ${graphemeKind(part)}`} disabled={!part.audio || !audio.has(part.audio)} aria-label={part.audio ? `听 ${part.letters} 的声音` : `${part.letters} 不发音`} onClick={() => { if (part.audio) void play(part.audio, false); }}>{part.letters}</button>)}</div>)}
        <p className="word-example">“{word.track === 'sight' ? word.example.en.split(new RegExp(`\\b(${word.word})\\b`, 'gi')).map((part, index) => part.toLowerCase() === word.word ? <mark className="sight-highlight" key={index}>{part}</mark> : part) : word.example.en}”</p>{!hasAudio && <p className="gentle-status" role="status">先看看这位朋友，声音准备好就能听啦。</p>}{message && <p role="status" className="gentle-status">{message}</p>}
      </div>
    </section>
    <button className="parent-tip-toggle" aria-expanded={parentOpen} onClick={() => setParentOpen(!parentOpen)}><Users /><span>和家人一起读</span><span>{parentOpen ? '−' : '+'}</span></button>
    {parentOpen && <section className="parent-tip"><div><span className="eyebrow">一起聊一聊</span><p>{word.parentTip.zh}</p></div><div><strong>{word.definition.zh}</strong><p>{word.example.zh}</p><small>{word.parentTip.en}</small></div></section>}
  </main></>;
}
