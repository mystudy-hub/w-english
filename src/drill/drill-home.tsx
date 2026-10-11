import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, CalendarCheck, Target } from 'lucide-react';
import { navigate } from '../app/router.ts';
import { drillRepository, saveSettings } from '../app/runtime.ts';
import { readSettings, useAppStore } from '../app/store.ts';
import type { DailyLog, Profile } from '../domain/models.ts';
import { defaultProfile } from '../domain/profiles.ts';
import { localDay } from '../data/drill-repository.ts';
import { Button, Header } from '../components/ui.tsx';

// 课本轨道首页：选档案、看今天要练什么、进入单元或错词本。
export function DrillHome() {
  const content = useAppStore((state) => state.content);
  const profileId = useAppStore((state) => state.activeProfileId);
  const units = content?.catalog.textbook?.units ?? [];
  const words = content?.catalog.textbook?.words ?? [];
  const [profile, setProfile] = useState<Profile>();
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [log, setLog] = useState<DailyLog>();
  const [due, setDue] = useState(0);
  const [mistakes, setMistakes] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const now = Date.now();
    const [loadedProfile, profiles, cards, dayLog] = await Promise.all([
      drillRepository.profile(profileId), drillRepository.profiles(), drillRepository.progress(profileId), drillRepository.dailyLog(profileId, localDay(now)),
    ]);
    setProfile(loadedProfile ?? defaultProfile(profileId));
    setAllProfiles(profiles);
    setDue(cards.filter((card) => card.learned && card.due <= now).length);
    setMistakes(cards.filter((card) => card.lapses > 0).map((card) => card.wordId));
    setLog(dayLog);
  }, [profileId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const start = (unitId: string, wordIds: string[] = []) => {
    useAppStore.setState({ drillUnitId: unitId, drillWordIds: wordIds });
    navigate('/drill/session');
  };
  const switchProfile = async (id: string) => {
    const settings = readSettings();
    useAppStore.setState({ activeProfileId: id });
    await saveSettings({ ...settings, activeProfileId: id });
  };

  if (!units.length) return <div className="app-page"><Header back={() => navigate('/')}><span>课本复习</span></Header>
    <main className="empty-page"><h1>课本内容还没准备好</h1><p>让家长在家长区把课本单元准备好，再回来练习。</p>
      <Button onClick={() => navigate('/')}><ArrowLeft size={18} />回到首页</Button></main></div>;

  return <div className="app-page"><Header back={() => navigate('/')}><span>课本复习</span></Header>
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-10">
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-amber-100">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm text-stone-500">今天要练</p>
            <p className="text-3xl font-bold text-stone-800">{due} 个复习词</p></div>
          <div className="text-right text-sm text-stone-500">
            <p>新词目标 {profile?.dailyNewTarget ?? 10} 个</p>
            <p>已学 {log?.newLearned ?? 0} · 复习 {log?.reviews ?? 0}</p>
            <p>答对 {log?.correct ?? 0} 次</p>
          </div>
        </div>
        {allProfiles.length > 1 && <div className="mt-3 flex flex-wrap gap-2">
          {allProfiles.map((entry) => <button key={entry.id} type="button" onClick={() => void switchProfile(entry.id)}
            className={`min-h-11 rounded-2xl border-2 px-4 ${entry.id === profileId ? 'border-amber-400 bg-amber-50' : 'border-amber-100 bg-white'}`}>
            {entry.avatar} {entry.name}</button>)}
        </div>}
        {mistakes.length > 0 && <div className="mt-4">
          <Button onClick={() => start(units[0]!.unitId, mistakes)}><Target size={18} />只练错词（{mistakes.length}）</Button>
        </div>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-stone-700"><BookOpen size={18} className="inline" /> 课本单元</h2>
        {units.map((unit) => {
          const count = words.filter((word) => `tb4a_u${word.textbook.unit}` === unit.unitId).length;
          return <div key={unit.unitId} className="flex items-center justify-between gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-amber-100">
            <div><p className="text-lg font-semibold text-stone-800">{unit.title}</p><p className="text-sm text-stone-500">{count} 个词</p></div>
            <Button className="primary" onClick={() => start(unit.unitId)}><CalendarCheck size={18} />开始</Button>
          </div>;
        })}
      </section>

      <p className="text-sm text-stone-500">答错的词会在同一轮里再出现一次，第二天还会到期的词会按间隔回来。</p>
    </main>
  </div>;
}
