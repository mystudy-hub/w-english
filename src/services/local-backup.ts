/** Read an existing database without requesting a version upgrade or replacing data. */
export async function exportLocalBackup(name = 'w-english') {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let expired = false;
    const request = indexedDB.open(name);
    const timeout = setTimeout(() => { expired = true; reject(new Error('本机备份读取超时')); }, 2000);
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error ?? new Error('没有可导出的本机记录')); };
    request.onsuccess = () => { clearTimeout(timeout); if (expired) request.result.close(); else resolve(request.result); };
  });
  try {
    const names = Array.from(db.objectStoreNames);
    const tables = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      if (!names.length) { resolve({}); return; }
      const result: Record<string, unknown[]> = {};
      const transaction = db.transaction(names, 'readonly');
      for (const table of names) {
        const request = transaction.objectStore(table).getAll();
        request.onsuccess = () => { result[table] = request.result; };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('本机备份读取失败'));
    });
    return { backupVersion: 1, exportedAt: new Date().toISOString(), database: name, databaseVersion: db.version, tables };
  } finally { db.close(); }
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
