import { Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { clearLearningRecords } from '../app/runtime.ts';
import { Button } from '../components/ui.tsx';

export function ClearRecordsDialog({ onClose, onCleared }: { onClose: () => void; onCleared: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId(); const descriptionId = useId();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const clear = async () => {
    setBusy(true); setError('');
    try { await clearLearningRecords(); onCleared(); }
    catch { setError('清除没有完成，原有记录仍然保留。请重试。'); setBusy(false); }
  };
  return <dialog ref={dialog} className="record-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={titleId}>清除本机学习记录？</h2>
    <p id={descriptionId}>将清除探索、听音和答题进度、全部题组、参与星与贴纸，并重新开始向导。此操作无法撤销。</p>
    <p>家长设置、休息状态和已下载内容会保留。需要保存学习足迹时，请先返回并导出记录。</p>
    <div className="button-row"><Button onClick={onClose} disabled={busy}>保留记录</Button><Button className="danger" disabled={busy} onClick={() => void clear()}><Trash2 />{busy ? '正在清除…' : '确认清除学习记录'}</Button></div>
    {error && <p className="setting-message" role="status">{error}</p>}
  </dialog>;
}
