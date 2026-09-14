import { ArrowLeft, Play, TrainFront, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { audio, beginSession, explorationRoute, learningPaused, playGuide, playWord, readySpellingWordIds, readyThemeIds, sessionRoute } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { LEVELS } from '../domain/config.ts';
import { graphemeKind } from '../domain/spelling.ts';
import { themeAccess } from '../domain/themes.ts';
import { Button, GuideBubble, Header, WordImage } from '../components/ui.tsx';

export function Phonics({ wordId }: { wordId: string }) {
  const state = useAppStore(); const settings = useSettings(); const content = state.content;
  const word = content?.catalog.words.find((entry) => entry.wordId === wordId);
  const theme = content?.catalog.themes.find((entry) => entry.wordIds.includes(wordId));
  const [activePart, setActivePart] = useState<number>(); const [playing, setPlaying] = useState(false); const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false); const generation = useRef(0); const owner = `phonics:${wordId}`;
  const permitted = Boolean(content && (content.manifest.stage ?? 0) >= 2 && word?.track === 'phonics'
    && word.phonicsStage <= LEVELS[settings.learningLevel].phonicsStage && theme
    && themeAccess(theme, content.catalog.themes, state.progress).unlocked && (!theme.unlock.prerequisiteThemeId || readyThemeIds().has(theme.themeId)));
  useEffect(() => () => { generation.current += 1; audio.cancelSpeech(owner); }, [owner]);
  if (!permitted || !word || !theme) return <><Header back={() => navigate(explorationRoute())} /><main className="empty-page"><h1>先和已经认识的朋友拼读吧</h1><Button onClick={() => navigate(explorationRoute())}><ArrowLeft />回到小小世界</Button></main></>;
  const ready = readySpellingWordIds().has(wordId);
  const play = async (partIndex?: number) => {
    if (learningPaused() || document.hidden) return;
    const unlock = audio.unlock(); const run = ++generation.current;
    const current = () => run === generation.current && !document.hidden && !learningPaused();
    audio.cancelSpeech(owner); setPlaying(true); setMessage(''); setActivePart(undefined);
    try {
      if (!await unlock || !current()) return;
      if (partIndex === undefined) {
        const guide = await playGuide('guide#blend', owner);
        if (!current() || guide?.status === 'cancelled') return;
      }
      const parts = partIndex === undefined ? word.graphemes.map((_, index) => index) : [partIndex];
      for (const index of parts) {
        const part = word.graphemes[index]!; if (part.audio === null) continue;
        setActivePart(index); const result = await audio.play(part.audio, owner);
        if (!current() || result.status === 'cancelled') return;
        if (result.status !== 'ended') throw new Error('拼读声音需要重试');
      }
      setActivePart(undefined);
      if (partIndex === undefined) {
        const result = await playWord(word.audio.word, wordId, owner, true);
        if (result.status === 'failed' && current()) throw new Error('单词需要重试');
      }
    } catch { if (current()) { setMessage('点一下泡泡或播放键，我们再听一次。'); void playGuide('guide#audio_retry', owner); } }
    finally { if (run === generation.current) { setPlaying(false); setActivePart(undefined); } }
  };
  const spell = async () => {
    void audio.unlock(); setStarting(true);
    try { const session = await beginSession(false, theme.themeId, 'tapSpell', wordId); if (session) navigate(sessionRoute(session)); }
    catch { setMessage('字母小火车还没有准备好，请再试一次。'); }
    finally { setStarting(false); }
  };
  return <><Header back={() => navigate(`/word/${wordId}`)} /><main className="phonics-page">
    <div className="phonics-heading"><div className="eyebrow">LITTLE SOUNDS, ONE WORD</div><h1>听听泡泡，把声音连起来</h1></div>
    <section className="phonics-workspace"><WordImage word={word} className="phonics-image" /><div className="phonics-practice"><h2>{word.word}</h2>
      <div className="blend-bubbles" role="group" aria-label="字母组合的声音">{word.graphemes.map((part, index) => <button key={index} className={`blend-bubble ${graphemeKind(part)} ${activePart === index ? 'active' : ''}`}
        aria-label={part.audio ? `听 ${part.letters} 的声音` : `${part.letters} 不发音`} disabled={!part.audio || !audio.has(part.audio) || state.muted} onClick={() => void play(index)}>{part.letters}{!part.audio && <VolumeX size={18} />}</button>)}</div>
      <Button className="primary blend-play" aria-label="连起来听单词" disabled={!ready || state.muted} onClick={() => void play()}><Play /><span data-mode-label>{playing ? '再听一遍' : '连起来听'}</span></Button>
    </div></section><div className="phonics-footer"><GuideBubble essential={Boolean(message) || !ready}>{message || (ready ? '每个泡泡都有自己的声音，连起来就是一个新朋友。' : '声音还在准备，先看看字母泡泡吧。')}</GuideBubble>
      <Button className="soft-gold" aria-label="拼这个单词" onClick={() => void spell()} disabled={!ready || starting || state.learningAccess !== 'writer' || Boolean(state.session && state.session.activity !== 'tapSpell')}><TrainFront /><span data-mode-label>我来拼一拼</span></Button>
    </div>
  </main></>;
}
