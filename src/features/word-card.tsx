import { ArrowLeft, BookOpen, Bubbles, Headphones, LoaderCircle, Star, TrainFront, Turtle, Users, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { audio, beginSession, discover, explorationRoute, learningPaused, playEffect, playGuide, playWord, readySpellingWordIds, readyThemeIds, sceneRoute, selectScene, sessionRoute, toggleFavorite } from '../app/runtime.ts';
import { useAppStore, useParentStore, useSettings } from '../app/store.ts';
import { LEVELS } from '../domain/config.ts';
import { Button, Header, WordImage } from '../components/ui.tsx';
import { useIdleGuide } from './use-idle-guide.ts';
import { themeAccess } from '../domain/themes.ts';
import { graphemeKind } from '../domain/spelling.ts';
import { speakWithWebSpeech, isSpeechSynthesisAvailable } from '../services/speech-fallback.ts';

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
  const favorites = useParentStore((s) => s.favoriteWords ?? []);
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
  const play = async (ref: string, countHeard: boolean, rate?: number) => {
    if (learningPaused() || Boolean(playing)) return;
    setMessage(''); setPlaying(ref);
    try {
      const result = await playWord(ref, wordId, owner, countHeard, rate);
      if (result.status === 'failed') {
        setMessage(audio.isMuted ? '先打开右上角的声音，再听一听。' : '再点一下小喇叭试试吧。');
        if (location.hash === `#/word/${wordId}`) void playGuide('guide#audio_retry', owner);
      }
    } finally {
      setPlaying(undefined);
    }
  };
  const speechOk = isSpeechSynthesisAvailable();
  const hasAudio = audio.has(word.audio.word) || speechOk;
  const hasSlowAudio = audio.has(word.audio.wordSlow);
  const slowRef = hasSlowAudio ? word.audio.wordSlow : word.audio.word;
  const canPlaySlow = hasSlowAudio || hasAudio || speechOk;
  const hasExampleAudio = audio.has(word.example.audio) || speechOk;
  const slowRate = settings.parentSettings.slowPlaybackRate ?? 0.60;
  const normalRate = settings.parentSettings.playbackRate ?? 0.85;
  const slowEffectiveRate = hasSlowAudio ? Math.max(0.4, Math.min(1.5, slowRate / 0.75)) : slowRate;
  const canPhonics = word.track === 'phonics' && word.phonicsStage <= LEVELS[settings.learningLevel].phonicsStage;
  const stage2 = (content?.manifest.stage ?? 0) >= 2;
  const isFav = Boolean(word && (favorites.includes(word.word.toLowerCase()) || favorites.includes(wordId.toLowerCase())));
  const handleToggleFav = async () => {
    if (!word) return;
    const added = await toggleFavorite(word.word);
    setMessage(added ? '已加入重点生词本 ⭐' : '已从生词本中移出');
    void playEffect('sfx#pop');
  };
  const spell = async () => {
    void audio.unlock();
    try { const started = await beginSession(false, theme.themeId, 'tapSpell', wordId); if (started) navigate(sessionRoute(started)); }
    catch { setMessage('字母小火车还没有准备好，请再试一次。'); }
  };
  const playSentence = async () => {
    if (learningPaused() || Boolean(playing)) return;
    setMessage(''); setPlaying('example');
    try {
      if (audio.has(word.example.audio)) {
        await playWord(word.example.audio, wordId, owner, false, Math.min(1.0, normalRate * 0.95));
      } else {
        await speakWithWebSpeech(word.example.en, Math.min(1.0, normalRate * 0.95));
      }
    } finally {
      setPlaying(undefined);
    }
  };
  const playGrapheme = async (partLetters: string, partAudio: string | null) => {
    if (partAudio && audio.has(partAudio)) {
      void play(partAudio, false);
    } else if (partLetters) {
      void speakWithWebSpeech(partLetters, slowRate);
    }
  };
  return <><Header back={back}><span className="header-chip"><BookOpen size={16} /> 认识一个新朋友</span></Header><main className={`word-page ${parentOpen ? 'with-parent' : ''}`}>
    <section className="word-card-surface"><div className="word-portrait"><span className="portrait-circle" /><WordImage word={word} /><span className="portrait-spark">✧</span></div>
      <div className="word-details"><span className="word-eyebrow">HELLO, LITTLE FRIEND</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1>{word.word}</h1>
          <button
            type="button"
            onClick={() => void handleToggleFav()}
            title={isFav ? '从生词本移出' : '加入生词本'}
            style={{
              background: isFav ? '#fef3c7' : '#f8fafc',
              border: isFav ? '1px solid #f59e0b' : '1px solid #e2e8f0',
              color: isFav ? '#d97706' : '#94a3b8',
              borderRadius: '9999px',
              padding: '4px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
            <span>{isFav ? '已加入生词本' : '加入生词本'}</span>
          </button>
        </div>
        <p className="word-definition">{word.definition[LEVELS[settings.learningLevel].definition]}</p>
        <div className="audio-controls">
          <Button className="primary" data-sfx="none" disabled={!hasAudio} onClick={() => void play(word.audio.word, true, normalRate)} aria-label="听单词">{playing === word.audio.word ? <LoaderCircle className="spinning" /> : <Volume2 />}<span data-mode-label>听一听</span></Button>
          <Button className="soft-gold" data-sfx="none" disabled={!canPlaySlow} onClick={() => void play(slowRef, true, slowEffectiveRate)} aria-label="慢慢听">{playing === slowRef ? <LoaderCircle className="spinning" /> : <Turtle />}<span data-mode-label>慢慢听</span></Button>
          <Button className="soft-blue" data-sfx="none" disabled={!hasExampleAudio} onClick={() => void playSentence()} aria-label="听例句">{playing === 'example' ? <LoaderCircle className="spinning" /> : <Headphones />}<span data-mode-label>听句子</span></Button>
        </div>
        {canPhonics && (stage2 ? <div className="word-activities"><Button className="soft-blue" aria-label="拼读泡泡" onClick={() => navigate(`/phonics/${wordId}`)}><Bubbles /><span data-mode-label>拼读泡泡</span></Button><Button className="soft-gold" aria-label="拼这个单词" disabled={learningAccess !== 'writer' || !readySpellingWordIds().has(wordId) || Boolean(session && session.activity !== 'tapSpell')} onClick={() => void spell()}><TrainFront /><span data-mode-label>字母小火车</span></Button></div>
          : <div className="phonics-row" aria-label="拼读声音">{word.graphemes.map((part, index) => <button key={`${part.letters}-${index}`} className={`phonics-bubble ${graphemeKind(part)}`} aria-label={`听 ${part.letters} 的声音`} onClick={() => void playGrapheme(part.letters, part.audio)}>{part.letters}</button>)}</div>)}
        <p className="word-example">“{word.track === 'sight' ? word.example.en.split(new RegExp(`\\b(${word.word})\\b`, 'gi')).map((part, index) => part.toLowerCase() === word.word ? <mark className="sight-highlight" key={index}>{part}</mark> : part) : word.example.en}”</p>{!hasAudio && <p className="gentle-status" role="status">先看看这位朋友，声音准备好就能听啦。</p>}{message && <p role="status" className="gentle-status">{message}</p>}
      </div>
    </section>
    <button className="parent-tip-toggle" aria-expanded={parentOpen} onClick={() => setParentOpen(!parentOpen)}><Users /><span>和家人一起读</span><span>{parentOpen ? '−' : '+'}</span></button>
    {parentOpen && <section className="parent-tip"><div><span className="eyebrow">一起聊一聊</span><p>{word.parentTip.zh}</p></div><div><strong>{word.definition.zh}</strong><p>{word.example.zh}</p><small>{word.parentTip.en}</small></div></section>}
  </main></>;
}
