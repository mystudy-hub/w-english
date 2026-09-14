import { Coffee, Heart, Leaf, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { audio, changeLearningRest, playGuide, recordLearningTime } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';
import { ForegroundUsageClock, REST_MS, type UsageAction } from '../domain/usage.ts';
import { Button, Ollie, ParentGate } from '../components/ui.tsx';

export function UsageLifecycle({ enabled, active, questionId, limitMinutes }: { enabled: boolean; active: boolean; questionId?: string; limitMinutes: 8 | 12 | 18 }) {
  const clock = useRef(new ForegroundUsageClock());
  const context = useRef({ enabled, active, questionId, limitMinutes });
  useEffect(() => {
    const previous = context.current;
    clock.current.setActive(false);
    const elapsed = clock.current.drain();
    if (previous.enabled && elapsed > 0) recordLearningTime(elapsed, previous.questionId);
    context.current = { enabled, active, questionId, limitMinutes };
    clock.current.setActive(enabled && active && !document.hidden);
    if (enabled && useAppStore.getState().usage.limitMinutes !== limitMinutes) recordLearningTime(0, questionId);
  }, [enabled, active, questionId, limitMinutes]);
  useEffect(() => {
    const flush = () => {
      const elapsed = clock.current.drain(); const state = useAppStore.getState();
      if (context.current.enabled && (elapsed > 0 || Date.now() < state.usage.updatedAt)) recordLearningTime(elapsed, context.current.questionId);
    };
    const visibility = () => { clock.current.setActive(context.current.enabled && context.current.active && !document.hidden); flush(); };
    const leave = () => { clock.current.setActive(false); flush(); };
    const interval = setInterval(flush, 1000);
    document.addEventListener('visibilitychange', visibility);
    addEventListener('w-english:checkpoint-time', flush); addEventListener('w-english:leave', leave);
    return () => {
      leave(); clearInterval(interval); document.removeEventListener('visibilitychange', visibility);
      removeEventListener('w-english:checkpoint-time', flush); removeEventListener('w-english:leave', leave);
    };
  }, []);
  return null;
}

export function RestDialog() {
  const usage = useAppStore((state) => state.usage); const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  const mounted = useRef(false); const attempted = useRef(false); const narrated = useRef(false);
  const [now, setNow] = useState(Date.now); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [retryAction, setRetryAction] = useState<UsageAction>('show');
  useEffect(() => {
    mounted.current = true;
    const node = dialog.current; node?.showModal(); audio.cancel();
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => { mounted.current = false; clearInterval(timer); node?.close(); audio.cancelSpeech('rest'); };
  }, []);
  useEffect(() => {
    if (usage.phase !== 'learning' || attempted.current) return;
    attempted.current = true; setBusy(true);
    void changeLearningRest('show').catch(() => {
      if (mounted.current) { setRetryAction('show'); setError('休息状态还没有保存好，请再试一次。'); }
    }).finally(() => { if (mounted.current) setBusy(false); });
  }, [usage.phase]);
  useEffect(() => {
    if (usage.phase === 'learning' || narrated.current) return;
    narrated.current = true;
    void playGuide('guide#rest', 'rest');
  }, [usage.phase]);
  const change = async (action: UsageAction) => {
    void audio.unlock(); setBusy(true); setError('');
    try { await changeLearningRest(action); }
    catch { if (mounted.current) { setRetryAction(action); setError('休息状态还没有保存好，请再试一次。'); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const left = Math.max(0, Math.min(REST_MS, (usage.restUntil ?? (usage.limitMinutes === 18 ? now + REST_MS : now)) - now));
  const seconds = Math.ceil(left / 1000);
  const resting = usage.phase === 'resting' || usage.limitMinutes === 18;
  return <dialog ref={dialog} className="rest-dialog" aria-labelledby={titleId} onCancel={(event) => event.preventDefault()}>
    <div className="rest-parent"><ParentGate /></div><Ollie className="rest-owl" /><h1 id={titleId}>让小眼睛休息一下</h1><p>看看远处的风景，伸伸小手。<br />小伙伴们会在这里等你。</p>
    {resting && left > 0 && <div className="rest-countdown" role="timer" aria-label="休息剩余时间" aria-live="off">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div>}
    {resting && left > 0 && (() => {
      const activityIndex = Math.floor(seconds / 60) % 3;
      const Icon = [Sparkles, Leaf, Heart][activityIndex]!;
      const titles = ['伸展小动作：学小猫伸个懒腰', '远眺小发现：找一找窗外的绿色', '温馨小互动：给家人一个温暖拥抱'];
      const texts = [
        '把小手高高举过头顶，像小猫咪一样伸展一下身体吧！',
        '转转小脑袋，看看窗外有没有绿树、花草或飞过的小鸟？',
        '去抱一抱身边的爸爸妈妈，眨眨小眼睛，放松一下。',
      ];
      return <div className="rest-activity-card" role="note" aria-label={titles[activityIndex]}>
        <div className="rest-activity-icon"><Icon size={24} /></div>
        <div className="rest-activity-body"><strong>{titles[activityIndex]}</strong><p>{texts[activityIndex]}</p></div>
      </div>;
    })()}
    <div className="button-row">{usage.phase === 'reminder' && <>
      <Button className="primary" aria-label="先休息一会儿" disabled={busy} onClick={() => void change('rest')}><Coffee /><span data-mode-label>先休息一会儿</span></Button>
      {usage.limitMinutes === 8 && <Button aria-label="继续探索" disabled={busy} onClick={() => void change('continue')}><Play /><span data-mode-label>继续探索</span></Button>}
      {usage.limitMinutes === 12 && !usage.extensionUsed && <Button aria-label="再玩三分钟" disabled={busy} onClick={() => void change('extend')}><Leaf /><span data-mode-label>再玩三分钟</span></Button>}
    </>}{usage.phase === 'resting' && <Button className="primary" aria-label="准备好了，继续探索" disabled={busy || left > 0} onClick={() => void change('continue')}><Play /><span data-mode-label>准备好了，继续探索</span></Button>}
      {error && <Button aria-label="再试一次" onClick={() => void change(retryAction)} disabled={busy}><RotateCcw /><span data-mode-label>再试一次</span></Button>}
    </div>{error && <p className="rest-error" role="status">{error}</p>}
  </dialog>;
}
