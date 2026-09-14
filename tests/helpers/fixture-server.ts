import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { syntheticContent } from './synthetic-content.ts';

/** Serve private test signals over real HTTP so the production SW handles offline audio. */
export async function fixtureServer(initial: ReturnType<typeof syntheticContent>, options: { directory?: string; base?: string } = {}) {
  const files = new Map(initial.files); const requests: string[] = [];
  const holds = new Map<string, { promise: Promise<void>; release: () => void }>();
  const root = resolve(options.directory ?? 'dist'); const base = options.base ?? '/';
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return; }
      const path = pathname.slice(base.length) || 'index.html';
      requests.push(path);
      await holds.get(path)?.promise;
      if (response.destroyed) return;
      const fixture = files.get(path);
      if (fixture) { response.writeHead(200, { 'Content-Type': fixture.mime, 'Cache-Control': 'no-store' }); response.end(fixture.bytes); return; }
      const absolute = resolve(root, path);
      if (!absolute.startsWith(`${root}${sep}`)) { response.writeHead(404); response.end(); return; }
      const bytes = await readFile(absolute);
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
    })().catch(() => { response.writeHead(404); response.end(); });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture server port');
  return { origin: `http://127.0.0.1:${address.port}`, requests,
    deploy(next: ReturnType<typeof syntheticContent>) { for (const [key, file] of next.files) files.set(key, file); },
    hold(path: string) {
      let release!: () => void; const promise = new Promise<void>((resolveHold) => { release = resolveHold; });
      holds.set(path, { promise, release });
      return () => { holds.delete(path); release(); };
    },
    override(path: string, bytes: Buffer, mime: string) { files.set(path, { bytes, mime }); },
    close: () => new Promise<void>((done, reject) => { for (const hold of holds.values()) hold.release(); holds.clear(); server.close((error) => error ? reject(error) : done()); server.closeAllConnections(); }),
  };
}
