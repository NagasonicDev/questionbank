const DB_NAME = "qb";
const DB_VERSION = 1;

export const DB_KEY = "qb-database";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
      if (!db.objectStoreNames.contains("tests")) db.createObjectStore("tests");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = open().catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function txn<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return getDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        let result: T;
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => {
          result = req.result as T;
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"));
      })
  );
}

// ---------- Database snapshot (the whole DB as a Uint8Array) ----------

export async function loadPersistedDb(): Promise<Uint8Array | null> {
  const db = await getDb();
  return new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(DB_KEY) as IDBRequest<ArrayBuffer | undefined>;
    req.onsuccess = () => {
      const value = req.result;
      resolve(value ? new Uint8Array(value) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function persistDb(bytes: Uint8Array): Promise<void> {
  const db = await getDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(bytes.buffer.slice(0), DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Question assets (keyed by asset_id) ----------

export async function putAsset(assetId: string, blob: Blob): Promise<void> {
  await txn("assets", "readwrite", (s) => s.put(blob, assetId));
}

export async function getAsset(assetId: string): Promise<Blob | null> {
  const blob = await txn<Blob | null>("assets", "readonly", (s) => s.get(assetId));
  return blob ?? null;
}

export async function deleteAsset(assetId: string): Promise<void> {
  await txn("assets", "readwrite", (s) => s.delete(assetId));
}

export async function listAssetIds(): Promise<string[]> {
  return txn<IDBValidKey[]>("assets", "readonly", (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>).then(
    (keys) => keys.map(String)
  );
}

export async function hasAsset(assetId: string): Promise<boolean> {
  const blob = await getAsset(assetId);
  return blob !== null && blob.size > 0;
}

export async function getAllAssets(): Promise<Array<{ key: string; blob: Blob }>> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("assets", "readonly");
    const store = tx.objectStore("assets");
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as Blob[];
      resolve(keys.map((key, i) => ({ key, blob: vals[i] })));
    };
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Generated test outputs (keyed by `${testId}:${which}`) ----------

export type TestFile = "test" | "solutions" | "preview";

export async function putTestFile(testId: string, which: TestFile, blob: Blob): Promise<void> {
  await txn("tests", "readwrite", (s) => s.put(blob, `${testId}:${which}`));
}

export async function getTestFile(testId: string, which: TestFile): Promise<Blob | null> {
  const blob = await txn<Blob | null>("tests", "readonly", (s) => s.get(`${testId}:${which}`));
  return blob ?? null;
}

export async function deleteTestFiles(testId: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tests", "readwrite");
    const store = tx.objectStore("tests");
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (String(cursor.key).startsWith(`${testId}:`)) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Wipe everything (questions, assets, generated tests) ----------

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  await Promise.all(
    ["kv", "assets", "tests"].map(
      (store) =>
        new Promise<void>((resolve) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        })
    )
  );
}

export async function getAllTestKeys(): Promise<string[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tests", "readonly");
    const req = tx.objectStore("tests").getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}