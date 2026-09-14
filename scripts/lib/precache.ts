/** Keep the current app-shell audio while older immutable files remain available to old clients. */
export function scopeCorePrecache<T extends { url: string }>(entries: T[], currentCoreUrls: readonly string[], base = '/') {
  const baseUrl = new URL(base, 'https://build.invalid/');
  const current = new Set(['core/index.json', ...currentCoreUrls]);
  return entries.filter((entry) => {
    const url = new URL(entry.url, baseUrl);
    if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) return true;
    const relative = url.pathname.slice(baseUrl.pathname.length);
    return !relative.startsWith('core/') || current.has(relative);
  });
}
