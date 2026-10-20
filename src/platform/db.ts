/**
 * Tiny promise wrapper around IndexedDB.
 *
 * Stores:
 *  - kv:      the app data ("data" → { json, savedAt }) — written only by the dashboard page
 *  - backups: snapshots of the app data, keyed by name
 *  - meta:    small records shared with the extension's background worker
 *             (latest Blackboard snapshot, background sync status, notified reminders…)
 *
 * Works in pages and in the extension service worker (no window/document access here).
 */

const DB_NAME = 'student-dashboard';
const DB_VERSION = 1;

export type StoreName = 'kv' | 'backups' | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support local storage (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another context upgraded the schema: close so it can proceed, reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Could not open local storage'));
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('Local storage is busy in another tab. Close other Student Dashboard tabs and try again.'));
    };
  });
  return dbPromise;
}

/** Run `fn` in one transaction and resolve once it has committed. */
export async function tx<T>(stores: StoreName | StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted (storage may be full)'));
  });
  let result: T;
  try {
    result = await fn(t);
  } catch (err) {
    try {
      t.abort();
    } catch {
      /* already finished */
    }
    await done.catch(() => {});
    throw err;
  }
  await done;
  return result;
}

export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return tx(store, 'readonly', (t) => promisify(t.objectStore(store).get(key)) as Promise<T | undefined>);
}

export function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  return tx(store, 'readwrite', async (t) => {
    await promisify(t.objectStore(store).put(value, key));
  });
}

export function del(store: StoreName, key: IDBValidKey): Promise<void> {
  return tx(store, 'readwrite', async (t) => {
    await promisify(t.objectStore(store).delete(key));
  });
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return tx(store, 'readonly', (t) => promisify(t.objectStore(store).getAll()) as Promise<T[]>);
}

export { promisify };
