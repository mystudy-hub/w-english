import { ArrowLeft, Check, Headphones, RotateCcw, Star, Sticker, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../app/router.ts';
import { abandonSession, audio, checkpointLearningTime, learningPaused, playEffect, playGuide, refreshRecords, repository, sceneRoute, sessionLock } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';
import { ActiveTimer } from '../domain/active-timer.ts';
import { Button, GuideBubble, Header, WordImage } from '../components/ui.tsx';
import { useIdleGuide } from './use-idle-guide.ts';

export function Lesson({ viewportReady }: { viewportReady: boolean }) {
  const state = useAppStore(); const session = state.session;
  const question = session?.questions[session.currentQuestionIndex];
  const word = state.content?.catalog.words.find((entry) => entry.wordId === question?.wordId);
  const sessionId = session?.id; const questionId = question?.id;
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null); const submitting = useRef(false);
  const timer = useRef<ActiveTimer>(); const questionRef = useRef(question);
  const promptGeneration = useRef(0);
  useEffect(() => { questionRef.current = question; }, [question]);
  const canPlay = Boolean(word && audio.has(word.audio.word) && !state.muted);

  const playPrompt = useCallback(async (cue?: string) => {
    if (!sessionId || !questionId || !word || !sessionLock.held || learningPaused() || document.hidden) return;
    const generation = ++promptGeneration.current;
    const unlocked = audio.unlock();
    audio.cancelSpeech(questionId);
    const pausedBudget = timer.current?.pause();
    setBusy(true); setMessage('');
    try {
      if (pausedBudget !== undefined) await repository.checkpointTime(sessionId, questionId, pausedBudget);
      const prepared = await repository.prepareQuestion(sessionId, questionId);
      if (generation !== promptGeneration.current || learningPaused() || document.hidden) return;
      useAppStore.setState({ session: prepared });
      if (!await unlocked) throw new Error('点一下小喇叭，我们再试试。');
      if (generation !== promptGeneration.current || learningPaused() || document.hidden) return;
      if (cue) {
        const narration = await playGuide(cue, questionId);
        if (generation !== promptGeneration.current || narration?.status === 'cancelled' || learningPaused() || document.hidden) return;
        if (cue === 'guide#listen_choose' && narration?.status === 'ended') await repository.markSessionNarration(sessionId, 'intro');
      }
      if (learningPaused() || document.hidden) return;
      const played = await audio.play(word.audio.word, questionId);
      if (generation !== promptGeneration.current || learningPaused() || document.hidden) return;
      if (played.status === 'cancelled') return;
      if (played.status !== 'ended') throw new Error('再点一次小喇叭试试吧。');
      await repository.heard(word.wordId, played.playbackId);
      const heard = await repository.questionHeard(sessionId, questionId);
      if (generation !== promptGeneration.current) return;
      useAppStore.setState({ session: heard });
    } catch {
      if (generation !== promptGeneration.current) return;
      const active = useAppStore.getState().session;
      if (active?.questions[active.currentQuestionIndex]?.id !== questionId) return;
      try { useAppStore.setState({ session: await repository.questionAudioFailed(sessionId, questionId) }); } catch { /* An exited question cannot be changed. */ }
      setMessage('声音暂时没有准备好，点一下小喇叭再试试。');
      if (generation === promptGeneration.current) void playGuide('guide#audio_retry', questionId);
    } finally { if (generation === promptGeneration.current) setBusy(false); }
  }, [sessionId, questionId, word]);

  useEffect(() => {
    if (canPlay && viewportReady) {
      if (sessionLock.held) {
        const snapshot = useAppStore.getState().session;
        const first = snapshot?.currentQuestionIndex === 0 && !snapshot.guideIntroPlayed && snapshot.questions[0]?.attemptCount === 0;
        void playPrompt(first ? 'guide#listen_choose' : undefined);
      } else setMessage('另一个窗口正在学习，请回到那个窗口继续。');
    }
    return () => { promptGeneration.current += 1; if (questionId) audio.cancel(questionId); };
  }, [questionId, canPlay, viewportReady, playPrompt]);

  useIdleGuide(questionId ?? 'lesson', {
    enabled: Boolean(question?.state === 'awaitingAnswer' && !question.hinted && viewportReady && canPlay),
    count: question?.idlePromptCount, lastPrompt: question?.lastIdlePromptAt,
    mode: session?.configSnapshot.interactionMode,
    onPrompt: async () => {
      if (sessionId && questionId && await repository.claimIdlePrompt(sessionId, questionId, Date.now())) await playPrompt('guide#idle');
    },
  });

  const submit = useCallback(async (selectedWordId: string | null, kind: 'select' | 'timeout' = 'select') => {
    const current = questionRef.current;
    if (!sessionId || !questionId || !current || submitting.current || !sessionLock.held || learningPaused() || document.hidden) return;
    const generation = promptGeneration.current;
    submitting.current = true; setBusy(true);
    try {
      const left = timer.current?.pause();
      const result = await repository.answer({ sessionId, questionId, attemptNo: current.attemptCount + 1,
        selectedWordId, kind, ts: Date.now(), ...(left === undefined ? {} : { remainingMs: left }) });
      if (generation !== promptGeneration.current) return;
      checkpointLearningTime();
      useAppStore.setState({ session: result.session });
      if (!result.duplicate && result.attempt.correct && !learningPaused()) void playEffect('sfx#chime_success', questionId);
      if (result.session.status === 'completed') {
        navigate(`/session/${sessionId}/end`); await refreshRecords();
      } else if (result.session.questions[result.session.currentQuestionIndex]?.id === questionId) {
        setMessage(result.session.questions[result.session.currentQuestionIndex]?.hinted ? '跟着小提示，再点一次吧。' : '再听一次，试试看。');
        await playPrompt(result.attempt.attemptNo === 1 && result.attempt.kind === 'select' ? 'guide#try_again' : undefined);
      }
    } catch { setMessage('这次选择还没有保存好，请再试一次。'); }
    finally { submitting.current = false; setBusy(false); }
  }, [sessionId, questionId, playPrompt]);

  const timed = question?.remainingMs !== null && question?.remainingMs !== undefined;
  const awaiting = question?.state === 'awaitingAnswer'; const hinted = question?.hinted ?? false;
  useEffect(() => {
    if (!questionId || !sessionId || !timed || !awaiting || hinted || !viewportReady || state.muted) return;
    const clock = new ActiveTimer(questionRef.current?.remainingMs ?? 0); timer.current = clock;
    let lastSaved = clock.remaining();
    const save = () => { void repository.checkpointTime(sessionId, questionId, clock.remaining()).catch(() => {}); };
    const leaving = () => { clock.pause(); save(); };
    const visibility = () => { if (document.hidden) { clock.pause(); audio.cancel(questionId); save(); } else clock.resume(); };
    if (!document.hidden) clock.resume();
    setRemaining(clock.remaining());
    const interval = setInterval(() => {
      const left = clock.remaining(); setRemaining(left);
      if (lastSaved - left >= 1000) { save(); lastSaved = left; }
      if (left <= 0 && !document.hidden) void submit(null, 'timeout');
    }, 100);
    document.addEventListener('visibilitychange', visibility);
    addEventListener('w-english:leave', leaving);
    return () => { clock.pause(); save(); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); removeEventListener('w-english:leave', leaving); if (timer.current === clock) timer.current = undefined; };
  }, [questionId, sessionId, timed, awaiting, hinted, viewportReady, submit, state.muted]);

  const exit = async () => {
    const route = location.hash; audio.cancel();
    try { if (await abandonSession() && location.hash === route) navigate(sceneRoute(session?.themeId)); }
    catch { if (location.hash === route && useAppStore.getState().session?.id === sessionId) setMessage('这一轮还没有结束成功，请再试一次返回。'); }
  };
  if (!session || !question || !word) return <main className="empty-page"><Headphones /><h1>准备好认识新朋友了吗？</h1><Button onClick={() => navigate(sceneRoute())}><ArrowLeft />回到场景</Button></main>;
  return <><Header back={() => void exit()}><div className="lesson-dots">{session.questions.map((entry, index) => <span key={entry.id} className={index < session.currentQuestionIndex ? 'done' : index === session.currentQuestionIndex ? 'current' : ''}>{index < session.currentQuestionIndex ? <Check size={14} /> : ''}</span>)}</div></Header>
    <main className="lesson-page"><div className="lesson-heading"><div className="eyebrow">LISTEN & DISCOVER</div><h1>听一听，找一找</h1><p>{question.hinted ? '跟着小提示，再认识一下这位朋友。' : '哪个小伙伴的名字，藏在声音里？'}</p></div>
      <Button className={`listen-orb ${busy ? 'is-playing' : ''}`} aria-label="重播题目声音" disabled={!canPlay || busy} onClick={() => void playPrompt()}><Volume2 /><span data-mode-label>{busy ? '听一听…' : '再听一次'}</span></Button>
      {timed && !hinted && <div className="timer-wrap" role="progressbar" aria-label="剩余作答时间" aria-valuemin={0} aria-valuemax={15} aria-valuenow={Math.ceil((remaining ?? question.remainingMs ?? 15000) / 1000)}><span style={{ width: `${(remaining ?? question.remainingMs ?? 15000) / 150}%` }} /></div>}
      <div className={`answer-grid options-${question.optionIds.length}`}>{question.optionIds.map((id) => {
        const option = state.content!.catalog.words.find((entry) => entry.wordId === id)!;
        return <button key={id} className={`answer-card ${question.hinted && id === question.wordId ? 'hinted' : ''}`} data-word-id={id} aria-label={option.illustration.type === 'image' ? option.illustration.alt : option.word}
          disabled={!awaiting || busy || !viewportReady || state.muted} onClick={() => void submit(id)}><WordImage word={option} />{question.hinted && id === question.wordId && <Star className="hint-star" />}</button>;
      })}</div><GuideBubble essential={Boolean(message)} mode={session.configSnapshot.interactionMode}>{message || (busy ? '竖起小耳朵，仔细听一听。' : '不用着急，跟着自己的节奏。')}</GuideBubble>
    </main></>;
}

export function RoundEnd({ sessionId, paused = false }: { sessionId: string; paused?: boolean }) {
  const stage = useAppStore((state) => state.content?.manifest.stage ?? 0);
  const [stars, setStars] = useState(0);
  const [total, setTotal] = useState(5);
  const effectPlayed = useRef(false);
  useEffect(() => { void repository.rewards(sessionId).then((rewards) => setStars(rewards.filter((reward) => reward.kind === 'participation').length)); }, [sessionId]);
  useEffect(() => {
    let active = true; const owner = `round-end:${sessionId}`;
    void repository.session(sessionId).then(async (session) => {
      if (!active || !session || session.status !== 'completed') return;
      setTotal(session.questions.length);
      if (paused || learningPaused()) return;
      if (!effectPlayed.current) { effectPlayed.current = true; void playEffect('sfx#star_coin', owner); }
      if (!session.guideOutroPlayed) {
        const result = await playGuide('guide#round_end', owner);
        if (active && result?.status === 'ended') await repository.markSessionNarration(sessionId, 'outro');
      }
    }).catch(() => {});
    return () => { active = false; audio.cancel(owner); };
  }, [sessionId, paused]);
  return <><Header back={() => navigate(sceneRoute())} /><main className="round-end"><div className="end-stars">{Array.from({ length: total }, (_, index) => <Star key={index} className={index < stars ? 'earned' : ''} />)}</div><h1>小小的你，发现了大大的世界。</h1><p>你认真参与了这一轮。和家人分享你的新发现吧！</p><div className="button-row"><Button className="primary" aria-label="回到场景" onClick={() => navigate(sceneRoute())}><ArrowLeft /><span data-mode-label>回到场景</span></Button><Button aria-label="再见新朋友" onClick={() => navigate(sceneRoute())}><RotateCcw /><span data-mode-label>再见新朋友</span></Button>{stage >= 2 && <Button className="soft-gold" aria-label="贴纸图鉴" onClick={() => navigate('/stickers')}><Sticker /><span data-mode-label>看看贴纸</span></Button>}</div></main></>;
}
