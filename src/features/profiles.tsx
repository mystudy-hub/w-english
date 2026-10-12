import { useEffect, useState } from 'react';
import { Plus, Trash2, UserRound } from 'lucide-react';
import { Button } from '../components/ui.tsx';
import { drillRepository } from '../app/runtime.ts';
import { useAppStore } from '../app/store.ts';
import { PROFILE_AVATARS } from '../domain/profiles.ts';
import type { Profile } from '../domain/models.ts';

const numberInput = 'w-20 rounded-xl border-2 border-amber-100 px-3 py-2 text-base';

// 家长页的孩子档案管理：新增、改名、换头像、调整每日新词目标、删除。
// 每个档案有自己的 SRS 进度、每日记录、金币与连击；正在使用的档案不允许在首页切换之外被删除。
export function ProfilePanel() {
  const activeProfileId = useAppStore((state) => state.activeProfileId);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [draft, setDraft] = useState({ name: '', avatar: PROFILE_AVATARS[0] as string, dailyNewTarget: 10 });
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<string>();

  const refresh = async () => setProfiles(await drillRepository.profiles());
  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    if (!draft.name.trim()) { setMessage('先给孩子起一个名字。'); return; }
    const created = await drillRepository.createProfile(draft);
    setDraft({ name: '', avatar: PROFILE_AVATARS[0] as string, dailyNewTarget: 10 });
    await refresh();
    setMessage(`已新增档案「${created.name}」，它现在有独立的进度、金币和连击。`);
  };

  const update = async (id: string, patch: Partial<Profile>) => {
    await drillRepository.updateProfile(id, patch);
    await refresh();
  };

  const remove = async (id: string) => {
    if (id === activeProfileId) { setMessage('这是正在使用的档案，先切换到别的档案再删除。'); setConfirming(undefined); return; }
    if (confirming !== id) { setConfirming(id); setMessage('再点一次「确认删除」会连同这个档案的复习进度与打卡记录一起删除。'); return; }
    await drillRepository.deleteProfile(id);
    setConfirming(undefined);
    await refresh();
    setMessage('档案和它的复习进度、打卡记录已删除。');
  };

  return <section className="record-panel"><h2><UserRound size={18} className="inline" /> 孩子的学习档案</h2>
    <p>每个档案有独立的复习进度、金币、连续天数和每日新词目标。复习首页可以在档案之间切换。</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {profiles.map((profile) => <div key={profile.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
        <input aria-label={`${profile.name}的名字`} className="w-40 rounded-xl border-2 border-amber-100 px-3 py-2 text-base" defaultValue={profile.name}
          onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== profile.name) void update(profile.id, { name }); }} />
        <span style={{ display: 'flex', gap: '0.25rem' }}>
          {PROFILE_AVATARS.map((avatar) => <button key={avatar} type="button" aria-label={`把${profile.name}的头像换成${avatar}`} aria-pressed={profile.avatar === avatar}
            onClick={() => void update(profile.id, { avatar })}
            className={`min-h-11 min-w-11 rounded-xl border-2 text-xl ${profile.avatar === avatar ? 'border-amber-400 bg-amber-50' : 'border-amber-100 bg-white'}`}>{avatar}</button>)}
        </span>
        <label className="text-sm text-stone-500">每日新词
          <input aria-label={`${profile.name}的每日新词目标`} className={`${numberInput} ml-2`} type="number" min={1} max={30} defaultValue={profile.dailyNewTarget}
            onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value !== profile.dailyNewTarget) void update(profile.id, { dailyNewTarget: Math.min(30, Math.round(value)) }); }} />
        </label>
        <span className="text-sm text-stone-500">🪙 {profile.coins} · 🔥 {profile.streak} · 累计 {profile.totalReviews}</span>
        {profile.id === activeProfileId && <span className="text-sm text-amber-700">正在使用</span>}
        <Button className="quiet" onClick={() => void remove(profile.id)}><Trash2 size={16} />{confirming === profile.id ? '确认删除' : '删除'}</Button>
      </div>)}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
      <input aria-label="新档案的名字" className="w-40 rounded-xl border-2 border-amber-100 px-3 py-2 text-base" placeholder="孩子名字" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <span style={{ display: 'flex', gap: '0.25rem' }}>
        {PROFILE_AVATARS.map((avatar) => <button key={avatar} type="button" aria-label={`新档案头像${avatar}`} aria-pressed={draft.avatar === avatar}
          onClick={() => setDraft({ ...draft, avatar })}
          className={`min-h-11 min-w-11 rounded-xl border-2 text-xl ${draft.avatar === avatar ? 'border-amber-400 bg-amber-50' : 'border-amber-100 bg-white'}`}>{avatar}</button>)}
      </span>
      <label className="text-sm text-stone-500">每日新词
        <input aria-label="新档案的每日新词目标" className={`${numberInput} ml-2`} type="number" min={1} max={30} value={draft.dailyNewTarget} onChange={(event) => setDraft({ ...draft, dailyNewTarget: Number(event.target.value) || 1 })} />
      </label>
      <Button className="primary" onClick={() => void create()}><Plus size={18} />新增档案</Button>
    </div>
    {message && <p className="setting-message" role="status">{message}</p>}
  </section>;
}
