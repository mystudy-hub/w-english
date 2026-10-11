import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { navigate } from '../app/router.ts';
import { drillRepository, playWord } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';
import { playSfx } from '../core/sfx.ts';
import type { TextbookWordEntry } from '../data/content-schema.ts';
import { defaultProfile } from '../domain/profiles.ts';
import { Button, Header } from '../components/ui.tsx';
import { DEFAULT_MODES, checkSpelling, makeQuestion, type Question } from './quiz.ts';
import { ChoiceCard, FlipCard, ListenButton, PromptPanel, PromptText, SessionResult, SpellingCard } from './ui.tsx';

interface Item { word: TextbookWordEntry; question: Question }

// 课本轨道的一轮练习：先到期复习再新词，答错的词在本轮队列尾部再来一次。
export function DrillSession() {
  const content = useAppStore((state) => state.content);
  const profileId = useAppStore((state) => state.activeProfileId);
  const unitId = useAppStore((state) => state.drillUnitId);
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [pool, setPool] = useState<TextbookWordEntry[]>([]);
  const [queue, setQueue] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(true);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const words = content?.catalog.textbook?.words ?? [];
      const unit = words.filter((word) => word.track === 'textbook' && `tb4a_u${word.textbook.unit}` === unitId);
      if (!unit.length) { if (!cancelled) setStatus('failed'); return; }
      const profile = await drillRepository.profile(profileId) ?? defaultProfile(profileId);
      const mistakeRound = useAppStore.getState().drillWordIds;
      // 核心 SRS 只认识 { id, core, unit } 这个最小视图；词条适配放在这里，共享内核不需要知道课本契约。
      // 只把本单元的词当词库传入；不传 unit 参数，每日新词上限才生效（规格 §13.4）。
      const plan = await drillRepository.plan({ profileId, words: unit.map((word) => ({ id: word.wordId, core: word.textbook.core, unit: word.textbook.unit })),
        dailyNewTarget: profile.dailyNewTarget, includeNonCore: profile.includeNonCore,
        ...(mistakeRound.length ? { wordIds: mistakeRound } : {}) });
      const byId = new Map(unit.map((word) => [word.wordId, word]));
      const items = plan.all.flatMap((entry) => { const word = byId.get(entry.id); return word ? [{ word, question: makeQuestion(word, unit, DEFAULT_MODES) }] : []; });
      if (cancelled) return;
      setPool(unit);
      setQueue(items);
      setStatus('ready');
    })().catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; };
  }, [content, profileId, unitId]);

  const item = queue[index];
  const finished = status === 'ready' && index >= queue.length;

  // 自动朗读只出现在听音题与拼写题；听音题先给声音再显示选项。
  useEffect(() => {
    if (!item) return;
    setOptionsVisible(item.question.mode !== 'listening');
    if (item.question.mode === 'listening' || item.question.mode === 'spelling') {
      void playWord(item.word.audio.word, item.word.wordId, 'drill', false);
    }
    if (item.question.mode !== 'listening') return;
    const timer = setTimeout(() => setOptionsVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [item]);

  const answer = useCallback(async (value: string, flipGrade?: 'again' | 'good') => {
    if (!item || busy.current) return;
    busy.current = true;
    const wasCorrect = flipGrade ? flipGrade === 'good'
      : item.question.mode === 'spelling' ? checkSpelling(value, item.question.answer)
      : item.question.mode === 'flip' ? false
      : value === item.question.answer;
    setChosen(value);
    setFeedback(wasCorrect ? 'correct' : 'wrong');
    playSfx(wasCorrect ? 'correct' : 'wrong');
    try {
      await drillRepository.review({ profileId, wordId: item.word.wordId, grade: wasCorrect ? (flipGrade ?? 'good') : 'again', now: Date.now() });
    } catch {
      useAppStore.setState({ notice: '这次练习的记录暂时没能保存。' });
    }
    if (!wasCorrect) setQueue((current) => [...current, { word: item.word, question: makeQuestion(item.word, pool, DEFAULT_MODES) }]);
    setAnswered((total) => total + 1);
    if (wasCorrect) setCorrect((total) => total + 1);
    setTimeout(() => { setFeedback(null); setChosen(null); setIndex((current) => current + 1); busy.current = false; }, 900);
  }, [item, pool, profileId]);

  const header = <Header back={() => navigate('/drill')}><span>课本复习</span></Header>;

  if (status === 'loading') return <div className="app-page">{header}<main className="empty-page"><h1>正在准备今天的词…</h1></main></div>;
  if (status === 'failed') return <div className="app-page">{header}<main className="empty-page"><h1>这个单元还没有准备好</h1>
    <p>课本内容尚未下载完整，先回到复习首页看看。</p><Button onClick={() => navigate('/drill')}><ArrowLeft size={18} />返回</Button></main></div>;
  if (!queue.length || finished) return <div className="app-page">{header}<main className="empty-page">
    {queue.length ? <SessionResult answered={answered} correct={correct} onDone={() => navigate('/drill')} />
      : <><h1>今天没有到期的词</h1><p>明天再来，或者挑一个单元练一练。</p><Button onClick={() => navigate('/drill')}><ArrowLeft size={18} />返回</Button></>}
  </main></div>;

  const question = item!.question;
  const prompt = question.mode === 'choice_en2zh' ? <PromptText>{question.prompt}</PromptText>
    : question.mode === 'choice_zh2en' ? <PromptText>{question.prompt}</PromptText>
    : question.mode === 'spelling' ? <><PromptText>{question.hintZh}</PromptText><p className="text-base text-stone-500">按听到的或记住的拼出来</p></>
    : question.mode === 'listening' ? <PromptText>听一听，选出听到的词</PromptText>
    : null;

  return <div className="app-page">{header}
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-10">
      <p className="text-sm text-stone-500">第 {Math.min(index + 1, queue.length)} / {queue.length} 题 · 已答对 {correct} 次</p>
      {question.mode === 'flip'
        ? <FlipCard word={item!.word} onPlay={() => void playWord(item!.word.audio.word, item!.word.wordId, 'drill', false)} onGrade={(grade) => void answer(grade, grade)} />
        : <>
          <PromptPanel>{prompt}</PromptPanel>
          {question.mode === 'spelling'
            ? <SpellingCard question={question} disabled={Boolean(feedback)} onAnswer={(value) => void answer(value)} />
            : <>
              <div className="flex justify-end"><ListenButton onPlay={() => void playWord(item!.word.audio.word, item!.word.wordId, 'drill', false)} /></div>
              {optionsVisible ? <ChoiceCard question={question} disabled={Boolean(feedback)} chosen={chosen} onAnswer={(value) => void answer(value)} /> : <p className="text-center text-stone-500">先听清楚再选…</p>}
            </>}
        </>}
      {feedback && <p role="status" className={`text-center text-lg font-semibold ${feedback === 'correct' ? 'text-emerald-600' : 'text-amber-700'}`}>
        {feedback === 'correct' ? '答对啦！' : `再看看：${item!.word.word} · ${item!.word.definition.zh}`}</p>}
    </main>
  </div>;
}
