/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheOnly } from 'workbox-strategies';
import { RangeRequestsPlugin } from 'workbox-range-requests';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
// No skipWaiting and no automatic reload: active learning pages keep their worker.
const base = new URL(import.meta.env.BASE_URL, self.location.origin).pathname;
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${base}index.html`)));
const verifiedAssets = new CacheOnly({ cacheName: 'w-english-content-v1', plugins: [new RangeRequestsPlugin()] });
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith(`${base}content/`) && !url.pathname.endsWith('/index.json'),
  async (options) => {
    // Hash verification must be able to repair a corrupted cached response.
    if (options.request.cache === 'no-store') return fetch(options.request);
    try { return await verifiedAssets.handle(options); }
    catch { return fetch(options.request); }
  });
// Only the app's hash-verified downloader writes content responses to this cache.
