import { useState } from 'react';
import { History } from 'lucide-react';
import legacyIdMap from '../../data/textbook/legacy-id-map.json';
import { Button } from '../components/ui.tsx';
import { useAppStore } from '../app/store.ts';
import { refreshRecords } from '../app/runtime.ts';
import { database } from '../data/database.ts';
import { importLegacySnapshot, readLegacySnapshot, type LegacyImportResult, type LegacySnapshot } from '../data/legacy-import.ts';

// 把 memoryApp（单词乐园）的复习进度、档案与打卡记录一次性并入合并后的应用。
// 旧库只读；导入是幂等的，重复点不会重复计数，也不会覆盖更新的进度。
export function LegacyImportPanel() {
  const content = useAppStore((state) => state.content);
  const [snapshot, setSnapshot] = useState<LegacySnapshot | null>();
  const [result, setResult] = useState<LegacyImportResult>();
  const [busy, setBusy] = useState(false);
  const words = content?.catalog.textbook?.words ?? [];

  const check = async () => {
    setBusy(true);
    try { setSnapshot(await readLegacySnapshot(legacyIdMap.words, words) ?? null); setResult(undefined); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!snapshot) return;
    setBusy(true);
    try { setResult(await importLegacySnapshot(database, snapshot)); await refreshRecords(); }
    finally { setBusy(false); }
  };

  return <section className="record-panel"><h2>旧版“单词乐园”记录</h2>
    <p>这台设备如果用过 memoryApp（译林 4A 单词记忆），可以把它的复习进度、孩子档案和打卡记录并进来。旧数据只读，不会被删除或改写；重复导入不会重复计数。</p>
    <div className="button-row">
      <Button disabled={busy || !words.length} onClick={() => void check()}><History size={18} />检查旧记录</Button>
      {snapshot ? <Button className="primary" disabled={busy} onClick={() => void apply()}><History size={18} />导入到本应用</Button> : null}
    </div>
    {snapshot === null && <p className="offline-detail">没有找到旧版记录，或者这台设备还没用过。</p>}
    {snapshot ? <p className="offline-detail">找到 {snapshot.profiles.length} 个档案、{snapshot.cards.length} 条复习进度、{snapshot.logs.length} 天打卡记录。
      {snapshot.unmappedWordIds.length ? `其中 ${snapshot.unmappedWordIds.length} 条词不在当前课本词库里，导入时会跳过。` : ''}</p> : null}
    {result ? <p className="offline-detail">导入完成：新增 {result.profiles} 个档案、{result.cards} 条进度、{result.logs} 天记录；
      {result.skippedCards ? `跳过 ${result.skippedCards} 条比本机更旧的进度。` : '没有覆盖任何更新的进度。'}</p> : null}
  </section>;
}
