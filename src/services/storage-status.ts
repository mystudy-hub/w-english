export interface StorageStatus {
  usage?: number; quota?: number; persisted?: boolean; persistenceSupported: boolean;
}
export async function storageStatus(): Promise<StorageStatus> {
  const storage = navigator.storage;
  const [estimate, persisted] = await Promise.allSettled([
    storage?.estimate?.(), storage?.persisted?.(),
  ]);
  const measured = estimate.status === 'fulfilled' ? estimate.value : undefined;
  const valid = (value?: number) => value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
  return { usage: valid(measured?.usage), quota: valid(measured?.quota),
    persisted: persisted.status === 'fulfilled' ? persisted.value : undefined,
    persistenceSupported: typeof storage?.persist === 'function' };
}
/** Call from a parent gesture; denial never prevents ordinary cached learning. */
export async function requestStoragePersistence(): Promise<boolean | undefined> {
  try { return await navigator.storage?.persist?.(); } catch { return undefined; }
}
export function storageSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
