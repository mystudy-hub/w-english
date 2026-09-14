import { Check, CloudDownload, Download, Eye, Headphones, Leaf, Pause, RefreshCw, ShieldCheck, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { navigate } from '../app/router.ts';
import { cleanContentCache, contentThemeProgress, explorationRoute, pauseContentDownload, prepareContent, repository, saveSettings, sceneRoute } from '../app/runtime.ts';
import { useAppStore, useSettings } from '../app/store.ts';
import { progressCounts } from '../domain/learning.ts';
import type { Settings } from '../domain/models.ts';
import { Button, Header } from '../components/ui.tsx';
import { requestStoragePersistence, storageSize, storageStatus, type StorageStatus } from '../services/storage-status.ts';
import { downloadJson } from '../services/local-backup.ts';
import { themeAccess } from '../domain/themes.ts';
import { ClearRecordsDialog } from './clear-records.tsx';

export function ParentPage() {
  const original = useSettings(); const state = useAppStore();
  const screenTimeHelpId = useId();
  const [clearing, setClearing] = useState(false); const [recordMessage, setRecordMessage] = useState('');
  const [draft, setDraft] = useState<Settings>(original); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const [space, setSpace] = useState<StorageStatus>(); const [cacheMessage, setCacheMessage] = useState(''); const [managing, setManaging] = useState(false);
  useEffect(() => { let active = true; void storageStatus().then((value) => { if (active) setSpace(value); }); return () => { active = false; }; }, [state.pack.state]);
  const counts = progressCounts(state.progress);
  const downloading = state.pack.state === 'downloading' || Object.values(state.themeProgress).some((pack) => pack.state === 'downloading');
  const parent = draft.parentSettings;
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const saved = await saveSettings({ ...draft, onboardingComplete: true });
      setMessage(saved ? '设置已保存。进行中的题组会保持原来的难度。' : '设置仅在本次体验中生效，不会保存到本机。');
    }
    catch { setMessage('设置没有保存成功，原来的设置仍然保留。请重试。'); }
    finally { setSaving(false); }
  };
  const exportRecords = async () => {
    try {
      const content = await repository.exportProgress();
      downloadJson(content, `w-english-progress-${new Date().toISOString().slice(0, 10)}.json`);
    } catch { setMessage('学习记录暂时无法导出，请稍后再试。'); }
  };
  const retain = async () => {
    const retained = await requestStoragePersistence();
    setCacheMessage(retained ? '浏览器已允许保留离线内容。主动清理浏览器数据仍会移除本机记录。' : '浏览器未授予长期保留，已下载内容仍可正常使用。');
    setSpace(await storageStatus());
  };
  const cleanup = async () => {
    setManaging(true); setCacheMessage('');
    try { const result = await cleanContentCache(); setCacheMessage(`已清理 ${storageSize(result.bytes)} 旧内容，学习记录已保留。`); setSpace(await storageStatus()); }
    catch { setCacheMessage('旧内容暂时无法清理，请稍后重试。'); }
    finally { setManaging(false); }
  };
  const packText = { idle: '等待准备', downloading: `正在保存 ${state.pack.percent}%`, ready: '已就绪，可离线使用', incomplete: '图片已保存，语音待准备', failed: '下载未完成，可以重试', quota: '可用空间不足', paused: '准备已暂停，可以继续' }[state.pack.state];
  return <><Header back={() => navigate(state.session ? sceneRoute(state.session.themeId) : explorationRoute())}><span className="header-chip"><ShieldCheck size={17} /> 家长伴学</span></Header><main className="parent-page">
    <div className="parent-title"><div><div className="eyebrow">GROW AT THEIR OWN PACE</div><h1>陪伴每一个小发现</h1><p>设置舒服的节奏，看见孩子的每一步探索。</p></div><Leaf className="parent-title-leaf" /></div>
    {state.learningAccess !== 'writer' && <div className="parent-notice" role="status">本次为卡片体验，学习记录和设置不会保存到本机。</div>}
    <div className="parent-columns"><section className="settings-panel"><h2>学习与操作</h2>
      <label className="setting-label">操作方式<select value={draft.interactionMode} onChange={(event) => setDraft({ ...draft, interactionMode: event.target.value as Settings['interactionMode'] })}><option value="tap">轻轻点一点 · 大按钮、语音陪伴</option><option value="drag">自己来探索 · 辅助文字、灵活操作</option></select></label>
      <label className="setting-label">学习等级<select value={draft.learningLevel} onChange={(event) => setDraft({ ...draft, learningLevel: event.target.value as Settings['learningLevel'] })}><option value="L1">L1 启蒙 · 3 张图片，无倒计时</option><option value="L2">L2 拼合 · 4 张图片，无倒计时</option><option value="L3">L3 进阶 · 4 张图片，15 秒有效时间</option></select></label>
      <label className="setting-label">向导陪伴<select value={parent.guideEnabled === null ? 'default' : String(parent.guideEnabled)} onChange={(event) => setDraft({ ...draft, parentSettings: { ...parent, guideEnabled: event.target.value === 'default' ? null : event.target.value === 'true' } })}><option value="default">跟随操作方式</option><option value="true">开启陪伴</option><option value="false">安静探索</option></select></label>
      {(state.content?.manifest.stage ?? 0) >= 2 && <label className="setting-label">休息间隔<select aria-label="休息间隔" aria-describedby={screenTimeHelpId} value={parent.screenTimeMinutes} onChange={(event) => setDraft({ ...draft, parentSettings: { ...parent, screenTimeMinutes: Number(event.target.value) as 8 | 12 | 18 } })}>
        <option value="8">8 分钟 · 建议 4～5 岁，温和提醒</option><option value="12">12 分钟 · 建议 6～7 岁，可延长一次 3 分钟</option><option value="18">18 分钟 · 建议 8～9 岁，休息 3 分钟</option>
      </select><small id={screenTimeHelpId}>只累计前台儿童页面的使用时间，家长页和后台暂停计时。到时先完成当前题；刷新会保留累计时间和休息状态。</small></label>}
      <div className="setting-divider" /><h2>声音与动效</h2>
      <label className="setting-label"><span><Volume2 size={17} /> 应用音量上限 <strong>{Math.round(parent.volumeCap * 100)}%</strong></span><input type="range" min="0.4" max="1" step="0.05" value={parent.volumeCap} onChange={(event) => setDraft({ ...draft, parentSettings: { ...parent, volumeCap: Number(event.target.value) } })} /><small>控制应用内音量；静音按钮可随时关闭声音。</small></label>
      <label className="toggle-setting"><span><strong>减少动态效果</strong><small>关闭跳动和粒子，同时尊重设备系统设置。</small></span><input type="checkbox" checked={parent.reducedMotion} onChange={(event) => setDraft({ ...draft, parentSettings: { ...parent, reducedMotion: event.target.checked } })} /></label>
      <Button className="primary save-settings" onClick={() => void save()} disabled={saving}>{saving ? <RefreshCw className="spinning" /> : <Check />}{saving ? '正在保存…' : '保存设置'}</Button>{message && <p className="setting-message" role="status">{message}</p>}
    </section><div className="parent-right"><section className="progress-panel"><h2>小小学习足迹</h2><p>参与星星与学习结果分别记录。</p><div className="progress-grid">{([
      ['探索过', counts.explored, Eye], ['完整听过', counts.heard, Headphones], ['首次答对', counts.firstCorrect, Check], ['复习答对', counts.reviewCorrect, Leaf],
    ] as const).map(([label, count, Icon]) => <div className="progress-stat" key={label}><Icon /><strong>{count}<small>词</small></strong><span>{label}</span></div>)}</div><small>复习答对：首次正确后至少 24 小时，在另一题中无提示、第一次选择答对。</small>{(state.content?.manifest.stage ?? 0) >= 2 && <small>已获得 {state.stickers.length} 枚贴纸。每 5 个不同词的有效首次答对获得一枚，与参与星分别记录。</small>}<Button className="quiet" onClick={() => void exportRecords()} disabled={state.storage !== 'persistent'}><Download size={18} />导出本机学习记录</Button></section>
      {(state.content?.manifest.stage ?? 0) >= 2 && <section className="record-panel"><h2>本机记录管理</h2><p>保留最近 90 天的作答明细，以及当前题组和最近 20 道已结束听音题所需的记录。词汇进度与贴纸长期保留。</p>
        <Button className="quiet" disabled={state.learningAccess !== 'writer'} onClick={() => { setRecordMessage(''); setClearing(true); }}><Trash2 size={18} />清除本机学习记录</Button>
        {recordMessage && <p className="setting-message" role="status">{recordMessage}</p>}
      </section>}
      <section className="offline-panel"><div className="offline-heading"><CloudDownload /><div><h2>把小小世界带在身边</h2><p>{packText}</p></div></div><div className="download-track"><span style={{ width: `${state.pack.percent}%` }} /></div>
        {state.pack.state === 'incomplete' && <p className="offline-detail">当前可以浏览图片和卡片。语音素材就绪后，将开放听音选图及完整离线学习。</p>}
        {state.pendingContent && <p className="offline-detail">新内容已准备好，将在下一轮开始时使用。</p>}
        {state.content && state.content.catalog.themes.length > 1 && <div className="theme-download-list">{state.content.catalog.themes.map((theme) => {
          const access = themeAccess(theme, state.content!.catalog.themes, state.progress); const pack = contentThemeProgress(theme.themeId);
          return <div key={theme.themeId}><strong>{theme.title.zh}</strong><small>{!access.unlocked ? `前置场景已首次答对 ${access.completed}/${access.required} 词` : pack?.state === 'ready' ? '已完整保存' : pack?.state === 'downloading' ? `保存中 ${pack.percent}%` : pack?.state === 'incomplete' ? '图片已保存，语音待准备' : '可以准备内容'}</small>
            {pack?.state === 'downloading' ? <Button className="quiet" onClick={pauseContentDownload}><Pause size={18} />暂停准备{theme.title.zh}</Button>
              : <Button className="quiet" disabled={!access.unlocked || downloading} onClick={() => void prepareContent(theme.themeId)}>{pack?.state === 'paused' ? '继续准备' : pack?.state === 'ready' ? '检查' : '准备'}{theme.title.zh}</Button>}</div>;
        })}</div>}
        {state.contentRecovery && <p className="offline-detail">{{ fallback: '部分本地内容缺失，已恢复到可完整使用的内容。', repair: '部分本地内容需要重新准备，已保存的学习记录仍然保留。', 'app-update': '新内容需要更新应用，当前继续使用已保存的内容。' }[state.contentRecovery]}</p>}
        {state.updateWaiting && <p className="offline-detail">应用更新已准备好。关闭所有应用窗口再打开后生效。</p>}
        {space?.usage !== undefined && space.quota !== undefined && <p className="offline-detail">此站点已用 {storageSize(space.usage)}，浏览器估计配额 {storageSize(space.quota)}。</p>}
        <div className="button-row">{downloading
          ? <Button className="quiet" onClick={pauseContentDownload}><Pause size={18} />暂停准备</Button>
          : <Button className="quiet" onClick={() => void prepareContent()}><RefreshCw size={18} />{state.pack.state === 'ready' ? '检查本地内容' : '继续准备内容'}</Button>}
          <Button className="quiet" onClick={() => void cleanup()} disabled={managing || downloading || state.learningAccess !== 'writer'}><Trash2 size={18} />清理旧内容</Button>
        </div>
        {space?.persistenceSupported && <Button className="quiet" disabled={space.persisted} onClick={() => void retain()}><ShieldCheck size={18} />{space.persisted ? '已允许保留离线内容' : '尽量保留离线内容'}</Button>}
        {cacheMessage && <p className="offline-detail" role="status">{cacheMessage}</p>}
      </section><p className="parent-footnote">记录保存在当前设备的浏览器中。更换设备或清理浏览器数据后，需要重新设置。</p></div></div>
  </main>{clearing && <ClearRecordsDialog onClose={() => setClearing(false)} onCleared={() => { setClearing(false); setRecordMessage('学习记录已清除。家长设置、休息状态和离线内容已保留。'); }} />}</>;
}
