import Dexie, { type EntityTable, type Table } from 'dexie';
import type { AttemptRecord, ContentPackRecord, GuideState, Reward, SessionSnapshot, Settings, UsageState, WordProgress } from '../domain/models.ts';
import { defaultUsage } from '../domain/usage.ts';

export const DATABASE_SCHEMA_VERSION = 2;
export const VERSION_ONE_STORES = {
  settings: 'key', guideState: 'key', wordProgress: 'wordId, firstCorrectAt, reviewCorrectAt, lastAskedAt',
  sessions: 'id, status, updatedAt', attempts: 'id, questionId, sessionId, [wordId+ts], ts',
  rewards: 'id, sessionId, kind', contentPacks: 'id, state, contentVersion, updatedAt',
};
function isKnownVersionOne(db: IDBDatabase, transaction: IDBTransaction) {
  const tables = Object.keys(VERSION_ONE_STORES);
  if (db.objectStoreNames.length !== tables.length || tables.some((name) => !db.objectStoreNames.contains(name))) return false;
  for (const [name, schema] of Object.entries(VERSION_ONE_STORES)) {
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
        if (event.oldVersion !== 10 || !request.transaction || !isKnownVersionOne(request.result, request.transaction)) {
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
  constructor(name = 'w-english') {
    super(name, { autoOpen: false, indexedDB: guardedFactory(Dexie.dependencies.indexedDB) });
    this.version(1).stores(VERSION_ONE_STORES);
    this.version(DATABASE_SCHEMA_VERSION).stores({ activityState: 'key' }).upgrade(async (transaction) => {
      const settings = await transaction.table('settings').get('local');
      const minutes = settings?.parentSettings?.screenTimeMinutes;
      await transaction.table('activityState').put(defaultUsage(minutes === 12 || minutes === 18 ? minutes : 8));
    });
    this.on('blocked', () => this.issue?.('blocked'));
    this.on('versionchange', () => { this.close(); this.issue?.('changed'); });
  }
  onStorageIssue(handler: (reason: 'blocked' | 'changed') => void) { this.issue = handler; }
}
export const database = new LearningDatabase();
