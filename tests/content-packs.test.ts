// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContentPackManager, memoryContentCache, type PackMetadata, type PackProgress } from '../src/services/content-packs.ts';
import type { ContentPackRecord } from '../src/domain/models.ts';
import { syntheticContent } from './helpers/synthetic-content.ts';

function setup(fixture = syntheticContent()) {
  const records = new Map<string, ContentPackRecord>();
  const cache = memoryContentCache();
  let pinnedId: string | undefined; let pinnedVersion: string | undefined;
  const metadata: PackMetadata = {
    all: async () => [...records.values()], put: async (record) => { records.set(record.id, structuredClone(record)); },
    remove: async (ids) => { for (const id of ids) records.delete(id); },
    activeSessionVersion: async () => pinnedVersion, activeSessionContentId: async () => pinnedId,
    activate: async (id, themeId) => {
      const record = records.get(id); if (!record || !['ready', 'active'].includes(record.state)) return false;
      if (themeId && record.readyThemeIds && !record.readyThemeIds.includes(themeId)) return false;
      for (const [key, value] of records) if (value.state === 'active') records.set(key, { ...value, state: 'ready' });
      records.set(id, { ...record, activeThemeId: themeId, state: 'active', activatedAt: Date.now() }); return true;
    },
  };
  let offline = false; let corruptedUrl = ''; let partialUrl = '';
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    if (offline) throw new TypeError('Offline test');
    const path = new URL(String(input)).pathname.slice(1); requests.push(path);
    const file = fixture.files.get(path);
    if (!file) return new Response('missing', { status: 404 });
    if (path === corruptedUrl) return new Response('corrupted');
    return new Response(Uint8Array.from(file.bytes), { status: path === partialUrl ? 206 : 200, headers: { 'Content-Type': file.mime } });
  };
  const options = { baseUrl: 'https://example.test/', metadata, cache, fetcher, delay: async () => {},
    hash: async (bytes: ArrayBuffer) => createHash('sha256').update(Buffer.from(bytes)).digest('hex') };
  return { manager: new ContentPackManager(options), options, records, cache, requests,
    offline: () => { offline = true; }, corrupt: (path: string) => { corruptedUrl = path; }, partial: (path: string) => { partialUrl = path; },
    pin: (id?: string, version?: string) => { pinnedId = id; pinnedVersion = version; },
    deploy: (next: ReturnType<typeof syntheticContent>) => { for (const [key, value] of next.files) fixture.files.set(key, value); },
  };
}

describe('content readiness and integrity', () => {
  it('does not mark an image-only preview as a complete learning pack', async () => {
    const fixture = syntheticContent({ audio: false }); const env = setup(fixture);
    const content = await env.manager.load(); const progress: PackProgress[] = [];
    await env.manager.download(content, (value) => progress.push(value));
    expect(progress.at(-1)?.state).toBe('incomplete'); expect(progress.at(-1)?.percent).toBeLessThan(100);
    expect(env.manager.readyWordIds(content).size).toBe(0);
    await expect(env.manager.activate(content)).rejects.toThrow('语音尚未齐全');
  });
  it('activates only after all files are verified and can reopen without the network', async () => {
    const env = setup(); const content = await env.manager.load();
    await env.manager.download(content, () => {});
    expect(env.records.get(content.id)?.state).toBe('ready');
    expect(env.manager.readyWordIds(content).size).toBe(10);
    await env.manager.activate(content); expect(env.records.get(content.id)?.state).toBe('active');
    env.offline(); const reopened = await new ContentPackManager(env.options).load();
    await env.manager.download(reopened, () => {});
    expect(env.manager.readyWordIds(reopened).size).toBe(10);
  });
  it('retries corruption but never publishes a ready flag for unverified bytes', async () => {
    const fixture = syntheticContent(); const env = setup(fixture); const content = await env.manager.load();
    const broken = fixture.manifest.assets['audio:animal_home']!.url; env.corrupt(broken);
    await expect(env.manager.download(content, () => {})).rejects.toThrow('校验失败');
    expect(env.requests.filter((path) => path === broken)).toHaveLength(4);
    expect(env.records.get(content.id)?.state).toBe('failed');
    expect(await env.cache.match(`https://example.test/${broken}`)).toBeUndefined();
  });
  it('rejects partial 206 responses even when their bytes would otherwise match', async () => {
    const fixture = syntheticContent(); const env = setup(fixture); const content = await env.manager.load();
    env.partial(fixture.manifest.assets['audio:animal_home']!.url);
    await expect(env.manager.download(content, () => {})).rejects.toThrow('206');
    expect(env.records.get(content.id)?.state).toBe('failed');
  });
  it('revalidates cached keys before activation and keeps an active session pinned', async () => {
    const fixture = syntheticContent(); const env = setup(fixture); const content = await env.manager.load();
    await env.manager.download(content, () => {});
    await env.cache.delete(`https://example.test/${fixture.manifest.assets['audio:animal_home']!.url}`);
    await expect(env.manager.activate(content)).rejects.toThrow('不完整');
    expect(env.records.get(content.id)?.state).toBe('degraded');
    const pinned = new ContentPackManager({ ...env.options, metadata: { ...env.options.metadata, activeSessionVersion: async () => '2026.09.1' } });
    expect(await pinned.activate(content)).toBe(false);
  });
  it('pins even a partially prepared preview to the exact manifest of an unfinished round', async () => {
    const env = setup(syntheticContent({ audio: false }));
    const previous = await env.manager.load(); await env.manager.download(previous, () => {});
    let touchedNewIndex = false;
    const resumed = new ContentPackManager({ ...env.options,
      metadata: { ...env.options.metadata, activeSessionVersion: async () => previous.manifest.contentVersion, activeSessionContentId: async () => previous.id },
      fetcher: async () => { touchedNewIndex = true; return new Response('new deployment', { status: 503 }); },
    });
    expect((await resumed.load()).id).toBe(previous.id);
    expect(touchedNewIndex).toBe(false);
  });
});

describe('scene download boundaries', () => {
  it('downloads only the selected scene and shared dependencies, then reuses common audio', async () => {
    const fixture = syntheticContent({ scenes: true }); const env = setup(fixture); const content = await env.manager.load();
    await env.manager.download(content, () => {}, ['animal_home']);
    expect([...env.manager.readyThemeIds(content)]).toEqual(['animal_home']);
    expect(env.manager.readyWordIds(content).size).toBe(7);
    expect(env.requests).not.toContain(fixture.manifest.assets['audio:sunny_garden']!.url);
    expect(env.requests).not.toContain(fixture.manifest.assets['/images/words/cup.svg']!.url);
    const phonics = fixture.manifest.assets['audio:phonics']!.url;
    const fetched = env.requests.filter((path) => path === phonics).length;
    expect(await env.manager.activate(content, 'animal_home')).toBe(true);
    await env.manager.download(content, () => {}, ['sunny_garden']);
    expect([...env.manager.readyThemeIds(content)]).toEqual(['animal_home', 'sunny_garden']);
    expect(env.requests.filter((path) => path === phonics)).toHaveLength(fetched);
    expect(env.requests).not.toContain(fixture.manifest.assets['audio:happy_school']!.url);
    expect(await env.manager.activate(content, 'sunny_garden')).toBe(true);
    env.offline(); const reopened = await new ContentPackManager(env.options).load();
    expect(reopened.activeThemeId).toBe('sunny_garden'); expect([...reopened.requestedThemeIds]).toEqual(['animal_home', 'sunny_garden']);
  });
  it('does not let missing speech in a different scene block a complete current scene', async () => {
    const env = setup(syntheticContent({ scenes: true, omitSprites: ['sunny_garden'] })); const content = await env.manager.load();
    const progress: PackProgress[] = [];
    await env.manager.download(content, (value) => progress.push(value), ['animal_home']);
    expect(progress.at(-1)?.state).toBe('ready'); expect(await env.manager.activate(content, 'animal_home')).toBe(true);
    await env.manager.download(content, (value) => progress.push(value), ['sunny_garden']);
    expect(progress.at(-1)?.state).toBe('incomplete');
    expect(env.records.get(content.id)?.state).toBe('active'); expect(env.records.get(content.id)?.activeThemeId).toBe('animal_home');
    await expect(env.manager.activate(content, 'sunny_garden')).rejects.toThrow('语音尚未齐全');
  });
  it('preserves the active scene if committing a second scene fails', async () => {
    const env = setup(syntheticContent({ scenes: true })); const content = await env.manager.load();
    await env.manager.download(content, () => {}, ['animal_home']); await env.manager.activate(content, 'animal_home');
    const put = env.options.metadata.put;
    env.options.metadata.put = async (record) => {
      if (record.readyThemeIds?.includes('sunny_garden')) throw new Error('Scene metadata failed');
      return put(record);
    };
    await expect(env.manager.download(content, () => {}, ['sunny_garden'])).rejects.toThrow('Scene metadata failed');
    expect(env.records.get(content.id)?.state).toBe('active'); expect(env.records.get(content.id)?.readyThemeIds).toEqual(['animal_home']);
    expect([...env.manager.readyThemeIds(content)]).toEqual(['animal_home']);
    expect(await env.manager.activate(content, 'sunny_garden')).toBe(false);
    env.options.metadata.put = put; await env.manager.download(content, () => {}, ['sunny_garden']);
    expect(await env.manager.activate(content, 'sunny_garden')).toBe(true);
  });
});

describe('content recovery, retention and quota', () => {
  it('detects missing audio at startup, falls back to a complete version and keeps an active round pinned', async () => {
    const first = syntheticContent(); const env = setup(first);
    const old = await env.manager.load(); await env.manager.download(old, () => {}); await env.manager.activate(old);
    const second = syntheticContent({ version: '2026.09.2', tone: 480 }); env.deploy(second);
    expect((await env.manager.load()).id).toBe(old.id);
    const next = env.manager.updateCandidate!; await env.manager.download(next, () => {}); await env.manager.activate(next);
    await env.cache.delete(env.manager.url(second.manifest.assets['audio:animal_home']!.url)); env.offline();
    const reopened = new ContentPackManager(env.options); const restored = await reopened.load();
    expect(restored.id).toBe(old.id); expect(reopened.recovery).toBe('fallback');
    expect(env.records.get(next.id)?.state).toBe('degraded');
    expect(reopened.readyWordIds(restored).size).toBe(10);
    env.pin(next.id, next.manifest.contentVersion);
    const pinned = new ContentPackManager(env.options); const snapshot = await pinned.load();
    expect(snapshot.id).toBe(next.id); expect(pinned.readyWordIds(snapshot).size).toBe(0);
    expect(pinned.recovery).toBe('repair');
  });

  it('retains current, previous complete and session-referenced packs while collecting shared files only once', async () => {
    const first = syntheticContent(); const env = setup(first);
    const old = await env.manager.load(); await env.manager.download(old, () => {}); await env.manager.activate(old);
    let latest = old;
    for (const [version, tone] of [['2026.09.2', 480], ['2026.09.3', 520]] as const) {
      env.deploy(syntheticContent({ version, tone })); await env.manager.load(); latest = env.manager.updateCandidate!;
      await env.manager.download(latest, () => {}); await env.manager.activate(latest);
    }
    env.pin(old.id, old.manifest.contentVersion);
    await env.manager.cleanup(); expect(env.records.size).toBe(3);
    env.pin(); const result = await env.manager.cleanup();
    expect(result.packs).toBe(1); expect(result.bytes).toBeGreaterThan(0); expect(env.records.has(old.id)).toBe(false);
    expect(env.records.get(latest.id)?.state).toBe('active');
    expect(await env.cache.match(env.manager.url(first.manifest.assets['/images/words/cat.svg']!.url))).toBeDefined();
    expect(await env.cache.match(env.manager.url(first.manifest.assets['audio:animal_home']!.url))).toBeUndefined();
    for (const asset of Object.values(latest.manifest.assets)) expect(await env.cache.match(env.manager.url(asset.url))).toBeDefined();
  });

  it('cleans abandoned staging on real quota errors and retries the already-verified bytes', async () => {
    const env = setup(); const old = await env.manager.load(); await env.manager.download(old, () => {}); await env.manager.activate(old);
    const abandoned = env.manager.url('content/audio/abandoned.0123456789abcdef.wav');
    await env.cache.put(abandoned, new Response('unused'));
    const next = syntheticContent({ version: '2026.09.2', tone: 480 }); env.deploy(next);
    const target = env.manager.url(next.manifest.assets[next.manifest.catalogAssetId]!.url);
    const put = env.cache.put;
    env.cache.put = async (url, response) => {
      if (url === target && await env.cache.match(abandoned)) throw new DOMException('Quota full', 'QuotaExceededError');
      return put(url, response);
    };
    expect((await env.manager.load()).id).toBe(old.id);
    expect(await env.cache.match(abandoned)).toBeUndefined();
    expect(await env.cache.match(target)).toBeDefined();
    expect(env.requests.filter((path) => target.endsWith(path))).toHaveLength(1);
    expect(env.records.get(old.id)?.state).toBe('active');
  });

  it('reports unrecoverable quota without removing the working version or claiming readiness', async () => {
    const env = setup(); const old = await env.manager.load(); await env.manager.download(old, () => {}); await env.manager.activate(old);
    const next = syntheticContent({ version: '2026.09.2', tone: 480 }); env.deploy(next); await env.manager.load();
    const candidate = env.manager.updateCandidate!; const put = env.cache.put;
    env.cache.put = async (url, response) => {
      if (url === env.manager.url(next.manifest.assets['audio:animal_home']!.url)) throw new DOMException('Quota full', 'QuotaExceededError');
      return put(url, response);
    };
    const updates: PackProgress[] = [];
    await expect(env.manager.download(candidate, (progress) => updates.push(progress))).rejects.toThrow('Quota full');
    expect(updates.at(-1)?.state).toBe('quota'); expect(updates.at(-1)?.percent).toBeLessThan(100);
    expect(env.records.get(old.id)?.state).toBe('active'); expect(env.records.get(candidate.id)?.state).toBe('quota');
    for (const asset of Object.values(old.manifest.assets)) expect(await env.cache.match(env.manager.url(asset.url))).toBeDefined();
  });

  it('pauses a download, preserves verified files, and resumes without fetching them again', async () => {
    const env = setup(); const content = await env.manager.load(); const updates: PackProgress[] = [];
    await expect(env.manager.download(content, (progress) => {
      updates.push(progress);
      if (progress.state === 'downloading' && progress.completedBytes > 0) env.manager.cancelDownload();
    })).rejects.toThrow('暂停');
    expect(updates.at(-1)?.state).toBe('paused'); expect(content.verifiedIds.size).toBeGreaterThan(0);
    const saved = [...content.verifiedIds].map((id) => content.manifest.assets[id]!.url);
    const before = new Map(saved.map((url) => [url, env.requests.filter((path) => path === url).length]));
    await env.manager.download(content, (progress) => updates.push(progress));
    expect(updates.at(-1)?.state).toBe('ready');
    expect(updates.at(-1)?.completedBytes).toBe(updates.at(-1)?.totalBytes);
    for (const url of saved) expect(env.requests.filter((path) => path === url).length).toBe(before.get(url));
  });

  it('keeps a failed metadata commit from becoming a visible ready pack', async () => {
    const env = setup(); const content = await env.manager.load(); const put = env.options.metadata.put;
    env.options.metadata.put = async (record) => {
      if (record.state === 'ready') throw new Error('Metadata transaction failed');
      return put(record);
    };
    await expect(env.manager.download(content, () => {})).rejects.toThrow('Metadata transaction failed');
    expect(env.records.get(content.id)?.state).toBe('failed'); expect(await env.manager.activate(content)).toBe(false);
    env.options.metadata.put = put; await env.manager.download(content, () => {});
    expect(await env.manager.activate(content)).toBe(true);
  });
});
