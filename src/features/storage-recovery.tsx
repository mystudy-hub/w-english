import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { boot, enterExperience, leaveExperience } from '../app/runtime.ts';
import { navigate } from '../app/router.ts';
import { useAppStore } from '../app/store.ts';
import { Button, Header } from '../components/ui.tsx';
import { downloadJson, exportLocalBackup } from '../services/local-backup.ts';

export function StorageRecovery() {
  const issue = useAppStore((state) => state.storageIssue);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const retry = async (temporary = false) => {
    setBusy(true); leaveExperience(); await boot(temporary, true);
    if (await enterExperience(!temporary)) {
      if (temporary) navigate('/setup');
      else { useAppStore.setState({ parentAuthorized: true }); navigate('/parent'); }
    }
    setBusy(false);
  };
  const backup = async () => {
    setBusy(true); setMessage('');
    try { downloadJson(await exportLocalBackup(), `w-english-backup-${new Date().toISOString().slice(0, 10)}.json`); setMessage('已发起备份下载，请在浏览器中保存并妥善保管。'); }
    catch { setMessage('浏览器暂时无法读取本机记录。可以关闭其他窗口后重试，或先进行临时体验。'); }
    finally { setBusy(false); }
  };
  const explanation = {
    newer: '本机记录来自更新的应用版本。请关闭所有旧窗口，重新打开更新后的应用；也可以先导出备份。',
    blocked: '另一个窗口正在占用本机记录。请关闭此应用的其他窗口，然后重新读取。',
    changed: '本机记录已由另一个窗口更新。请重新打开应用，使用与记录匹配的版本。',
    unavailable: '浏览器暂时无法读取或保存学习记录。可以重新读取、导出已有记录，或先进行临时体验。',
  }[issue ?? 'unavailable'];
  return <><Header back={() => { leaveExperience(); navigate('/'); }} /><main className="empty-page"><ShieldCheck /><h1>先保留好本机学习记录</h1><p>{explanation}</p>
    <div className="button-row"><Button className="primary" disabled={busy} onClick={() => void retry()}><RefreshCw />重新读取</Button><Button disabled={busy} onClick={() => void backup()}><Download />导出本机备份</Button><Button disabled={busy} onClick={() => void retry(true)}>临时体验</Button></div>
    {message && <p role="status">{message}</p>}</main></>;
}
