import Dexie, { type EntityTable, type Table } from 'dexie';
import type { AttemptRecord, ContentPackRecord, DailyLog, GuideState, Profile, Reward, SessionSnapshot, Settings, SrsCardState, UsageState, WordProgress } from '../domain/models.ts';
import { DEFAULT_PROFILE_ID, defaultProfile } from '../domain/profiles.ts';
import { defaultUsage } from '../domain/usage.ts';

export const DATABASE_SCHEMA_VERSION = 3;
export const VERSION_ONE_STORES = {
  settings: 'key', guideState: 'key', wordProgress: 'wordId, firstCorrectAt, reviewCorrectAt, lastAskedAt',
  sessions: 'id, status, updatedAt', attempts: 'id, questionId, sessionId, [wordId+ts], ts',
  rewards: 'id, sessionId, kind', contentPacks: 'id, state, contentVersion, updatedAt',
};
export const VERSION_TWO_STORES = { ...VERSION_ONE_STORES, activityState: 'key' };
export const VERSION_THREE_STORES = {
  ...VERSION_TWO_STORES,
  profiles: 'id, createdAt',
  srsProgress: '[profileId+wordId], [profileId+due]',
  dailyLogs: '[profileId+day]',
};
// 每个已发布的原生版本号对应一份已知表结构；未知旧结构必须提前中止。
const KNOWN_LAYOUTS: Record<number, Record<string, string>> = { 10: VERSION_ONE_STORES, 20: VERSION_TWO_STORES };
function isKnownLayout(db: IDBDatabase, transaction: IDBTransaction, stores: Record<string, string>) {
  const tables = Object.keys(stores);
  if (db.objectStoreNames.length !== tables.length || tables.some((name) => !db.objectStoreNames.contains(name))) return false;
  for (const [name, schema] of Object.entries(stores)) {
    const [primary, ...indexes] = schema.split(',').map((field) => field.trim()); const store = transaction.objectStore(name);
    if (store.keyPath !== primary || store.autoIncrement || store.indexNames.length !== indexes.length) return false;
    for (const index of indexes) {
      if (!store.indexNames.contains(index)) return false;
      const stored = store.index(index); const key = index.startsWith('[') ? index.slice(1, -1).split('+') : index;
      if (stored.unique || stored.multiEntry || JSON.stringify(stored.keyPath) !== JSON.stringify(key)) return false;
    }
  }
  return true;
}
function guardedFactory(factory: IDBFactory | undefined) {
  if (!factory) return undefined;
  return new Proxy(factory, { get(target, property) {
    if (property === 'open') return (name: string, version?: number) => {
      // Dexie retries VersionError without a version, then may patch an unknown schema.
      // Restrict every open, including retries, to our explicitly declared migration.
      if (version === undefined) throw new DOMException('本机记录需要更新的应用版本', 'VersionError');
      if (version !== DATABASE_SCHEMA_VERSION * 10) throw new DOMException('本机记录结构需要明确的数据迁移', 'SchemaError');
      const request = target.open(name, version);
      request.addEventListener('upgradeneeded', (event) => {
        if (event.oldVersion === 0) return;
        const layout = KNOWN_LAYOUTS[event.oldVersion];
        if (!layout || !request.transaction || !isKnownLayout(request.result, request.transaction, layout)) {
          event.stopImmediatePropagation(); request.transaction?.abort();
        }
      });
      return request;
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export class LearningDatabase extends Dexie {
  private issue?: (reason: 'blocked' | 'changed') => void;
  settings!: EntityTable<Settings, 'key'>;
  guideState!: EntityTable<GuideState, 'key'>;
  wordProgress!: EntityTable<WordProgress, 'wordId'>;
  sessions!: EntityTable<SessionSnapshot, 'id'>;
  attempts!: EntityTable<AttemptRecord, 'id'>;
  rewards!: Table<Reward, string>;
  contentPacks!: EntityTable<ContentPackRecord, 'id'>;
  activityState!: EntityTable<UsageState, 'key'>;
  profiles!: EntityTable<Profile, 'id'>;
  srsProgress!: EntityTable<SrsCardState, 'profileId'>;
  dailyLogs!: EntityTable<DailyLog, 'profileId'>;
  constructor(name = 'w-english') {
    super(name, { autoOpen: false, indexedDB: guardedFactory(Dexie.dependencies.indexedDB) });
    this.version(1).stores(VERSION_ONE_STORES);
    this.version(2).stores({ activityState: 'key' }).upgrade(async (transaction) => {
      const settings = await transaction.table('settings').get('local');
      const minutes = settings?.parentSettings?.screenTimeMinutes;
      await transaction.table('activityState').put(defaultUsage(minutes === 12 || minutes === 18 ? minutes : 8));
    });
    // v3：新增多档案、SRS 进度与每日记录；旧记录一字不改，旧设置由 settingsSchema 的默认值补齐 activeProfileId。
    this.version(DATABASE_SCHEMA_VERSION).stores({ profiles: 'id, createdAt', srsProgress: '[profileId+wordId], [profileId+due]', dailyLogs: '[profileId+day]' })
      .upgrade(async (transaction) => {
        const profiles = transaction.table('profiles');
        if (!await profiles.get(DEFAULT_PROFILE_ID)) await profiles.add(defaultProfile());
      });
    this.on('blocked', () => this.issue?.('blocked'));
    this.on('versionchange', () => { this.close(); this.issue?.('changed'); });
  }
  onStorageIssue(handler: (reason: 'blocked' | 'changed') => void) { this.issue = handler; }
}
export const database = new LearningDatabase();
