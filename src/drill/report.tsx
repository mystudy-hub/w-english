import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, BookOpen, Target, Volume2 } from 'lucide-react';
import { navigate } from '../app/router.ts';
import { drillRepository, playWord, saveSettings } from '../app/runtime.ts';
import { readSettings, useAppStore } from '../app/store.ts';
import type { DailyLog, Profile, SrsCardState } from '../domain/models.ts';
import { defaultProfile } from '../domain/profiles.ts';
import { effectiveStreak, localDay } from '../domain/day.ts';
import { Button, Header } from '../components/ui.tsx';

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

// 课本轨道的学习报告：掌握度、最近 7 天统计与错词本。
export function DrillReport() {
  const content = useAppStore((state) => state.content);
  const profileId = useAppStore((state) => state.activeProfileId);
  const words = useMemo(() => content?.catalog.textbook?.words ?? [], [content]);
  const [profile, setProfile] = useState<Profile>();
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [cards, setCards] = useState<SrsCardState[]>([]);
  const [mastery, setMastery] = useState<{ total: number; learned: number; mastered: number; dueNow: number }>();

  const refresh = useCallback(async () => {
    const now = Date.now();
    const [loadedProfile, profiles, dayLogs, progress] = await Promise.all([
      drillRepository.profile(profileId), drillRepository.profiles(), drillRepository.dailyLogs(profileId), drillRepository.progress(profileId),
    ]);
    setProfile(loadedProfile ?? defaultProfile(profileId));
    setAllProfiles(profiles);
    setLogs(dayLogs.sort((a, b) => a.day.localeCompare(b.day)));
    setCards(progress);
    const stats = await drillRepository.mastery({ profileId, words: words.map((word) => ({ id: word.wordId, core: word.textbook.core, unit: word.textbook.unit })),
      includeNonCore: (loadedProfile ?? defaultProfile(profileId)).includeNonCore, now });
    setMastery(stats);
  }, [profileId, words]);

  useEffect(() => { void refresh(); }, [refresh]);

  const switchProfile = async (id: string) => {
    const settings = readSettings();
    useAppStore.setState({ activeProfileId: id });
    await saveSettings({ ...settings, activeProfileId: id });
  };

  // 最近 7 天（含今天），缺失的天补零，便于画连续的柱状图。
  const week = (() => {
    const byDay = new Map(logs.map((log) => [log.day, log]));
    const days: { day: string; label: string; log: DailyLog }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      days.push({ day, label: `${date.getMonth() + 1}/${date.getDate()} 周${WEEKDAY_ZH[date.getDay()]}`, log: byDay.get(day) ?? { profileId, day, newLearned: 0, reviews: 0, correct: 0 } });
    }
    return days;
  })();
  const weekMax = Math.max(1, ...week.map((entry) => entry.log.newLearned + entry.log.reviews));
  const weekTotals = week.reduce((acc, entry) => ({ newLearned: acc.newLearned + entry.log.newLearned, reviews: acc.reviews + entry.log.reviews, correct: acc.correct + entry.log.correct }),
    { newLearned: 0, reviews: 0, correct: 0 });

  // 错词本：答错过（lapses > 0）的词，按答错次数排序。
  const byId = new Map(words.map((word) => [word.wordId, word]));
  const mistakes = cards.filter((card) => card.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses || (a.due - b.due))
    .flatMap((card) => { const word = byId.get(card.wordId); return word ? [{ card, word }] : []; });

  const startMistakes = () => {
    useAppStore.setState({ drillUnitId: 'tb4a_u1', drillWordIds: mistakes.map((entry) => entry.card.wordId) });
    navigate('/drill/session');
  };

  if (!words.length) return <div className="app-page"><Header back={() => navigate('/')}><span>学习报告</span></Header>
    <main className="empty-page"><h1>课本内容还没准备好</h1><p>让家长在家长区把课本单元准备好，再回来看报告。</p>
      <Button onClick={() => navigate('/')}><ArrowLeft size={18} />回到首页</Button></main></div>;

  const learnedPct = mastery ? Math.round((mastery.learned / mastery.total) * 100) : 0;
  const masteredPct = mastery ? Math.round((mastery.mastered / mastery.total) * 100) : 0;

  return <div className="app-page"><Header back={() => navigate('/drill')}><span>学习报告</span></Header>
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-10">
      {allProfiles.length > 1 && <section className="flex flex-wrap gap-2">
        {allProfiles.map((entry) => <button key={entry.id} type="button" onClick={() => void switchProfile(entry.id)}
          className={`min-h-11 rounded-2xl border-2 px-4 ${entry.id === profileId ? 'border-amber-400 bg-amber-50' : 'border-amber-100 bg-white'}`}>
          {entry.avatar} {entry.name}</button>)}
      </section>}

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-amber-100">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-700"><BarChart3 size={18} /> 掌握度</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-amber-50 p-3"><p className="text-2xl font-bold text-stone-800">{mastery?.learned ?? 0}<span className="text-sm text-stone-400"> / {mastery?.total ?? 0}</span></p><p className="mt-1 text-xs text-stone-500">已学</p></div>
          <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-2xl font-bold text-emerald-700">{mastery?.mastered ?? 0}</p><p className="mt-1 text-xs text-stone-500">已掌握</p></div>
          <div className="rounded-2xl bg-sky-50 p-3"><p className="text-2xl font-bold text-sky-700">{mastery?.dueNow ?? 0}</p><p className="mt-1 text-xs text-stone-500">今日待复习</p></div>
        </div>
        <div className="mt-4 space-y-2">
          <div><div className="h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${learnedPct}%` }} /></div>
            <p className="mt-1 text-xs text-stone-400">已学 {learnedPct}%</p></div>
          <div><div className="h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${masteredPct}%` }} /></div>
            <p className="mt-1 text-xs text-stone-400">已掌握（间隔 ≥ 7 天）{masteredPct}%</p></div>
        </div>
        <p className="mt-4 text-sm text-amber-700">🪙 {profile?.coins ?? 0} · 🔥 连续 {profile ? effectiveStreak(profile, Date.now()) : 0} 天</p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-amber-100">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-700"><BookOpen size={18} /> 最近 7 天</h2>
        <div className="mt-4 flex items-end justify-between gap-2" style={{ height: '120px' }}>
          {week.map((entry) => {
            const height = Math.round(((entry.log.newLearned + entry.log.reviews) / weekMax) * 100);
            return <div key={entry.day} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end justify-center">
                <div className="flex w-full max-w-8 flex-col justify-end overflow-hidden rounded-t-xl" style={{ height: `${Math.max(height, 4)}%` }}>
                  <div className="w-full bg-sky-300" style={{ height: entry.log.reviews ? `${(entry.log.reviews / Math.max(1, entry.log.newLearned + entry.log.reviews)) * 100}%` : 0 }} />
                  <div className="w-full bg-amber-300" style={{ height: entry.log.newLearned ? `${(entry.log.newLearned / Math.max(1, entry.log.newLearned + entry.log.reviews)) * 100}%` : 0 }} />
                </div>
              </div>
              <p className="text-[10px] leading-tight text-stone-400">{entry.label}</p>
            </div>;
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-stone-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-300" />新学 {weekTotals.newLearned}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-300" />复习 {weekTotals.reviews}</span>
          <span>共答对 {weekTotals.correct} 次</span>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-amber-100">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-700"><Target size={18} /> 错词本（{mistakes.length}）</h2>
          {mistakes.length > 0 && <Button className="primary" onClick={startMistakes}>只练错词</Button>}
        </div>
        {mistakes.length === 0 ? <p className="mt-3 text-sm text-stone-500">还没有答错过单词，继续保持！</p> : <ul className="mt-3 flex flex-col gap-2">
          {mistakes.map(({ card, word }) => <li key={card.wordId}
            className="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-stone-800">{word.word}<span className="ml-2 text-sm font-normal text-stone-400">{word.definition.zh}</span></p>
              <p className="text-xs text-stone-400">Unit {word.textbook.unit} · 答错 {card.lapses} 次{card.due <= Date.now() ? ' · 今天要复习' : ''}</p>
            </div>
            <button type="button" aria-label={`播放 ${word.word}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 active:scale-95"
              onClick={() => void playWord(word.audio.word, word.wordId, 'drill', false)}><Volume2 size={18} /></button>
          </li>)}
        </ul>}
      </section>

      <p className="text-sm text-stone-500">今天：{localDay(Date.now())}；报告每次进入自动刷新。</p>
    </main>
  </div>;
}
