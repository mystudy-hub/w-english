import { Check, Hand, Move, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../app/router.ts';
import { explorationRoute, saveSettings } from '../app/runtime.ts';
import { useSettings } from '../app/store.ts';
import type { InteractionMode, LearningLevel } from '../domain/models.ts';
import { Button, Header, Ollie } from '../components/ui.tsx';

export function Setup() {
  const current = useSettings();
  const [mode, setMode] = useState<InteractionMode>(current.interactionMode);
  const [level, setLevel] = useState<LearningLevel>(current.learningLevel);
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const save = async () => {
    setSaving(true); setError('');
    try { await saveSettings({ ...current, interactionMode: mode, learningLevel: level, onboardingComplete: true }); navigate(explorationRoute()); }
    catch { setError('设置还没有保存成功，请再试一次。'); }
    finally { setSaving(false); }
  };
  return <><Header /><main className="setup-page">
    <div className="setup-heading"><Ollie /><div><div className="eyebrow"><ShieldCheck size={16} /> 先请家长帮个小忙</div><h1>找到舒服的学习节奏</h1><p>操作方式与学习等级可以分别选择，以后随时调整。</p></div></div>
    <section className="setup-section"><h2><span>01</span> 怎样和世界打招呼？</h2><div className="mode-choices">
      <button className={`choice-card ${mode === 'tap' ? 'selected' : ''}`} aria-pressed={mode === 'tap'} onClick={() => setMode('tap')}><Hand /><strong>轻轻点一点</strong><p>更大的按钮，语音向导陪伴。适合刚开始探索的孩子。</p>{mode === 'tap' && <Check className="choice-check" />}</button>
      <button className={`choice-card ${mode === 'drag' ? 'selected' : ''}`} aria-pressed={mode === 'drag'} onClick={() => setMode('drag')}><Move /><strong>自己来探索</strong><p>辅助文字、更灵活的操作。听音选图仍然轻点作答。</p>{mode === 'drag' && <Check className="choice-check" />}</button>
    </div></section>
    <section className="setup-section"><h2><span>02</span> 从哪里开始？</h2><div className="level-choices">{([
      ['L1', '启蒙', '3 张图片 · 没有倒计时'], ['L2', '拼合', '4 张图片 · 没有倒计时'], ['L3', '进阶', '4 张图片 · 15 秒作答'],
    ] as const).map(([value, title, detail]) => <button key={value} className={`level-card ${level === value ? 'selected' : ''}`} aria-pressed={level === value} onClick={() => setLevel(value)}><span className="level-number">{value}</span><strong>{title}</strong><small>{detail}</small>{level === value && <Check size={18} />}</button>)}</div></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="setup-submit"><span>没有考试，也不用着急。</span><Button className="primary" onClick={() => void save()} disabled={saving}><Sparkles />{saving ? '正在保存…' : '准备好，一起出发'}</Button></div>
  </main></>;
}
