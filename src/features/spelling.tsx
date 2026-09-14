import { ArrowLeft, ArrowRight, Check, Eye, TrainFront, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { abandonSession, audio, checkpointLearningTime, learningPaused, playEffect, playGuide, playWord, refreshRecords, repository, sceneRoute, sessionLock } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore } from '../app/store.ts';
import { Button, GuideBubble, Header, WordImage } from '../components/ui.tsx';
import { spellingReadyToFinish } from '../domain/spelling.ts';
import type { SessionSnapshot } from '../domain/models.ts';

function publish(session: SessionSnapshot) {
  const current = useAppStore.getState().session;
  if (current?.currentQuestionIndex !== session.currentQuestionIndex || session.status !== 'active') checkpointLearningTime();
  useAppStore.setState({ session });
  if (session.status === 'completed') { navigate(`/session/${session.id}/end`); void refreshRecords(); }
}

export function Spelling({ viewportReady }: { viewportReady: boolean }) {
  const state = useAppStore(); const session = state.session;
  const question = session?.questions[session.currentQuestionIndex]; const spelling = question?.spelling;
  const word = state.content?.catalog.words.find((entry) => entry.wordId === question?.wordId);
  const sessionId = session?.id; const questionId = question?.id;
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const operation = useRef(false); const generation = useRef(0);
  const nextSlot = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ tile: number; x: number; y: number; moved: boolean }>();
  const [drag, setDrag] = useState<{ tile: number; x: number; y: number }>(); const suppressClick = useRef(false);
  const isSpelling = session?.activity === 'tapSpell';
  const canPlay = Boolean(isSpelling && word && audio.has(word.audio.word) && !state.muted);
  const valid = useCallback((run: number) => {
    const current = useAppStore.getState().session;
    return generation.current === run && sessionLock.held && !document.hidden && !learningPaused() && current !== undefined && current.id === sessionId
      && current.status === 'active' && current.questions[current.currentQuestionIndex]?.id === questionId;
  }, [sessionId, questionId]);

  const continueQuestion = useCallback(async (snapshot: SessionSnapshot, run: number, wordJustHeard: boolean) => {
    if (!sessionId || !questionId || !word || !valid(run)) return;
    let current = snapshot.questions[snapshot.currentQuestionIndex]!;
    const part = current.spelling?.pendingPart;
    if (part !== undefined) {
      const ref = word.graphemes[part]?.audio;
      if (!ref) throw new Error('找不到本段声音');
      const sound = await audio.play(ref, questionId);
      if (!valid(run) || sound.status === 'cancelled') return;
      if (sound.status !== 'ended') throw new Error('声音需要重试');
      snapshot = await repository.heardSpellingPart(sessionId, questionId, part, word);
      if (!valid(run)) return;
      publish(snapshot); current = snapshot.questions[snapshot.currentQuestionIndex]!; wordJustHeard = false;
    }
    if (!spellingReadyToFinish(current, word)) return;
    if (!wordJustHeard) {
      const prepared = await repository.prepareQuestion(sessionId, questionId);
      if (!valid(run)) return;
      publish(prepared);
      const whole = await playWord(word.audio.word, word.wordId, questionId, true);
      if (!valid(run) || whole.status === 'cancelled') return;
      if (whole.status !== 'ended') throw new Error('完整单词需要重试');
      const heard = await repository.questionHeard(sessionId, questionId);
      if (!valid(run)) return;
      publish(heard);
    }
    const finished = await repository.completeSpelling(sessionId, questionId, word, Date.now());
    if (!valid(run)) return;
    publish(finished); if (!learningPaused()) void playEffect('sfx#chime_success', questionId);
  }, [sessionId, questionId, word, valid]);

  const failed = useCallback(async (run: number) => {
    if (!sessionId || !questionId || !valid(run)) return;
    try {
      const snapshot = await repository.questionAudioFailed(sessionId, questionId);
      if (valid(run)) { publish(snapshot); setMessage('点一下小喇叭，我们接着听。'); void playGuide('guide#audio_retry', questionId); }
    } catch { if (valid(run)) setMessage('这一步还没有保存好，请再试一次。'); }
  }, [sessionId, questionId, valid]);

  const playPrompt = useCallback(async () => {
    if (!sessionId || !questionId || !word || !sessionLock.held || learningPaused() || document.hidden) return;
    const unlock = audio.unlock(); const run = ++generation.current;
    audio.cancelSpeech(questionId); setBusy(true); setMessage('');
    try {
      if (!await unlock) throw new Error('需要再次点播');
      if (!valid(run)) return;
      const original = useAppStore.getState().session!;
      if (original.questions[original.currentQuestionIndex]?.spelling?.skipped) {
        const played = await playWord(word.audio.word, word.wordId, questionId, true);
        if (played.status === 'failed' && valid(run)) setMessage('点一下小喇叭，我们再听一次。');
        return;
      }
      const prepared = await repository.prepareQuestion(sessionId, questionId);
      if (!valid(run)) return;
      publish(prepared);
      if (prepared.currentQuestionIndex === 0 && !prepared.guideIntroPlayed && !prepared.questions[0]!.spelling!.placed.length) {
        const guide = await playGuide('guide#spell', questionId);
        if (!valid(run) || guide?.status === 'cancelled') return;
        if (guide?.status === 'ended') await repository.markSessionNarration(sessionId, 'intro');
      }
      if (!valid(run)) return;
      const played = await playWord(word.audio.word, word.wordId, questionId, true);
      if (!valid(run) || played.status === 'cancelled') return;
      if (played.status !== 'ended') throw new Error('单词还没播放完');
      const heard = await repository.questionHeard(sessionId, questionId);
      if (!valid(run)) return;
      publish(heard); await continueQuestion(heard, run, true);
    } catch { await failed(run); }
    finally { if (generation.current === run) setBusy(false); }
  }, [sessionId, questionId, word, valid, failed, continueQuestion]);

  useEffect(() => {
    if (canPlay && viewportReady) void playPrompt();
    return () => { generation.current += 1; if (questionId) audio.cancelSpeech(questionId); };
  }, [canPlay, viewportReady, questionId, playPrompt]);
  useEffect(() => { nextSlot.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [questionId, spelling?.placed.length]);

  const place = async (tile: number) => {
    if (!sessionId || !questionId || !word || operation.current || busy || !valid(generation.current)) return;
    operation.current = true; const run = ++generation.current; setBusy(true); setMessage('');
    const unlocked = audio.unlock();
    try {
      if (!await unlocked || !valid(run)) return;
      const result = await repository.placeSpellingLetter(sessionId, questionId, tile, word);
      if (!valid(run)) return;
      publish(result.session);
      if (result.accepted) await continueQuestion(result.session, run, false);
      else setMessage('再看看下一节小车厢，慢慢来。');
    } catch { await failed(run); }
    finally { operation.current = false; if (generation.current === run) setBusy(false); }
  };
  const showAnswer = async () => {
    if (!sessionId || !questionId || operation.current || busy || !valid(generation.current)) return;
    operation.current = true; const run = ++generation.current; setBusy(true); audio.cancelSpeech(questionId);
    try {
      const revealed = await repository.showSpellingAnswer(sessionId, questionId);
      if (valid(run)) { publish(revealed); setMessage('一起看看完整的单词，下次再来拼一拼。'); }
    } catch { if (valid(run)) setMessage('这一步还没有保存好，请重试。'); }
    finally { operation.current = false; if (generation.current === run) setBusy(false); }
  };
  const next = async () => {
    if (!sessionId || !questionId || !word || operation.current || busy || !valid(generation.current)) return;
    operation.current = true; const run = ++generation.current; setBusy(true);
    try { const finished = await repository.completeSpelling(sessionId, questionId, word, Date.now()); if (valid(run)) publish(finished); }
    catch { if (valid(run)) setMessage('这一步还没有保存好，请重试。'); }
    finally { operation.current = false; if (generation.current === run) setBusy(false); }
  };
  const exit = async () => {
    const route = location.hash; const run = ++generation.current; audio.cancelSpeech(questionId);
    try { if (await abandonSession() && location.hash === route) navigate(sceneRoute(session?.themeId)); }
    catch {
      if (generation.current === run && location.hash === route && useAppStore.getState().session?.id === sessionId) {
        setBusy(false); setMessage('这一轮还没有结束成功，可以点小喇叭继续，或再试一次返回。');
      }
    }
  };
  if (!isSpelling || !session || !question || !word || !spelling) return <><Header back={() => navigate(sceneRoute())} /><main className="empty-page"><TrainFront /><h1>准备好和字母做朋友了吗？</h1><Button onClick={() => navigate(sceneRoute())}><ArrowLeft />回到场景</Button></main></>;
  const enabled = question.state === 'awaitingAnswer' && spelling.pendingPart === undefined && !spelling.skipped && !busy && !state.muted && viewportReady;
  const mode = session.configSnapshot.interactionMode;
  return <><Header back={() => void exit()}><div className="lesson-dots">{session.questions.map((entry, index) => <span key={entry.id} className={index < session.currentQuestionIndex ? 'done' : index === session.currentQuestionIndex ? 'current' : ''}>{index < session.currentQuestionIndex ? <Check size={14} /> : ''}</span>)}</div></Header>
    <main className="spelling-page"><div className="spelling-heading"><div><div className="eyebrow">ONE LETTER AT A TIME</div><h1>把字母小火车接起来</h1></div><Button className="soft-blue" aria-label="重播拼字单词" disabled={!canPlay || busy} onClick={() => void playPrompt()}><Volume2 /><span data-mode-label>再听一遍</span></Button></div>
      <section className="spelling-workspace"><WordImage word={word} className="spelling-image" /><div className="spelling-track" role="group" aria-label="单词车厢">
        {word.spelling.map((letter, index) => <div key={index} ref={index === spelling.placed.length ? nextSlot : undefined} data-spelling-slot={index} className={`letter-slot ${index === spelling.placed.length && !spelling.skipped ? 'next-slot' : ''} ${spelling.skipped ? 'revealed' : ''}`} aria-label={`第 ${index + 1} 个字母${index < spelling.placed.length || spelling.skipped ? ` ${letter}` : ''}`}>
          {index < spelling.placed.length || spelling.skipped ? letter : <span aria-hidden="true">·</span>}</div>)}
      </div></section>
      {!spelling.skipped && <div className={`spelling-bank ${mode === 'drag' ? 'allows-drag' : ''}`} role="group" aria-label="可用字母">{spelling.tiles.map((tile) => <button key={tile} data-letter-tile={tile} className={`letter-tile ${spelling.placed.includes(tile) ? 'placed' : ''} ${drag?.tile === tile ? 'dragging' : ''}`}
        style={drag?.tile === tile ? { translate: `${drag.x}px ${drag.y}px` } : undefined}
        aria-label={`字母 ${word.spelling[tile]}，第 ${tile + 1} 块`} disabled={!enabled || spelling.placed.includes(tile)}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } void place(tile); }}
        onKeyDown={() => { suppressClick.current = false; }}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (mode !== 'drag' || event.button !== 0) return;
          void audio.unlock(); event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = { tile, x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const start = pointer.current; if (!start || start.tile !== tile) return;
          const x = event.clientX - start.x; const y = event.clientY - start.y;
          start.moved ||= Math.hypot(x, y) > 8;
          if (start.moved) setDrag({ tile, x, y });
        }}
        onPointerUp={(event) => {
          const start = pointer.current; pointer.current = undefined; setDrag(undefined);
          if (!start?.moved) return;
          suppressClick.current = true;
          const bounds = nextSlot.current?.getBoundingClientRect();
          if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) void place(tile);
        }}
        onPointerCancel={() => { pointer.current = undefined; suppressClick.current = false; setDrag(undefined); }}>
        {word.spelling[tile]}
      </button>)}</div>}
      <div className="spelling-footer"><GuideBubble essential={Boolean(message)} mode={mode}>{message || (busy ? '竖起小耳朵，听听这节小车厢。' : mode === 'drag' ? '可以把字母拖到下一节车厢，也可以点一点。' : '按顺序点一点，把小车厢接起来。')}</GuideBubble>
        {spelling.skipped ? <Button className="primary" aria-label="认识下一位" onClick={() => void next()} disabled={busy}><ArrowRight /><span data-mode-label>认识下一位</span></Button>
          : <Button className="quiet" aria-label="看看完整单词" onClick={() => void showAnswer()} disabled={busy}><Eye /><span data-mode-label>一起看看</span></Button>}
      </div>
    </main></>;
}
