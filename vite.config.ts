import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFile } from 'node:fs/promises';
import { scopeCorePrecache } from './scripts/lib/precache.ts';

const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react(), tailwind(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    registerType: 'prompt', injectRegister: false,
    manifest: {
      name: 'W-English · 动物之家', short_name: 'W-English', lang: 'zh-CN',
      description: '和 Ollie 一起听英语、发现新朋友。', theme_color: '#fffdf5', background_color: '#fffdf5',
      display: 'standalone', orientation: 'landscape', start_url: './', scope: './', id: './',
      icons: [{ src: 'icons/ollie.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: 'icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,woff2,svg,png,json,mp3,wav}'],
      globIgnores: ['content/**'], maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      manifestTransforms: [async (entries) => {
        const core = JSON.parse(await readFile(new URL('./public/core/index.json', import.meta.url), 'utf8')) as { assets: Record<string, { url: string }> };
        return { manifest: scopeCorePrecache(entries, Object.values(core.assets).map((asset) => asset.url), base), warnings: [] };
      }],
    },
    devOptions: { enabled: false },
  })],
  build: { target: ['chrome111', 'safari16.4'], sourcemap: false, chunkSizeWarningLimit: 650 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
