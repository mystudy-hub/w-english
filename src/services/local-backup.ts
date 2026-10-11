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

export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error('备份文件不是合法的 JSON 格式'));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

export async function importLocalBackup(data: unknown, name = 'w-english') {
  if (!data || typeof data !== 'object' || !('tables' in data)) {
    throw new Error('无效的备份文件：缺少数据表');
  }
  const payload = data as { tables: Record<string, unknown[]> };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error ?? new Error('打开数据库失败'));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const storeNames = Object.keys(payload.tables).filter((key) => db.objectStoreNames.contains(key));
    if (!storeNames.length) throw new Error('备份文件中没有可匹配的数据表');

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeNames, 'readwrite');
      for (const tableName of storeNames) {
        const store = transaction.objectStore(tableName);
        store.clear();
        const records = payload.tables[tableName];
        if (Array.isArray(records)) {
          for (const item of records) {
            store.put(item);
          }
        }
      }
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('数据恢复写入失败'));
    });
  } finally {
    db.close();
  }
}
