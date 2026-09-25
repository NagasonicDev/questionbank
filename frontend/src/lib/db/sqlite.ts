import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { SCHEMA_SQL, BUILTIN_QUESTION_TYPES } from "./schema";
import * as idb from "./indexeddb";

let db: Database | null = null;
let ready: Promise<Database> | null = null;

async function initDb(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => `${import.meta.env.BASE_URL}sql-wasm.wasm` });
  const bytes = await idb.loadPersistedDb();
  if (bytes && bytes.byteLength > 0) {
    db = new SQL.Database(bytes);
  } else {
    db = new SQL.Database();
    db.run(SCHEMA_SQL);
    for (const [key, label] of BUILTIN_QUESTION_TYPES) {
      db.run("INSERT OR IGNORE INTO question_type (type_key, display_name) VALUES (?, ?)", [key, label]);
    }
    markDirty();
  }
  db.run("PRAGMA foreign_keys = ON;");
  return db;
}

export function getDb(): Promise<Database> {
  if (!ready) {
    ready = initDb().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

// ---------- Persistence (debounced export to IndexedDB) ----------

let dirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function markDirty(): void {
  dirty = true;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flush();
  }, 500);
}

export async function flush(): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!dirty || !db) return;
  dirty = false;
  const bytes = db.export();
  await idb.persistDb(bytes);
}

// ---------- Query helpers ----------

// Run a set of statements atomically (open transaction, rollback on error).
export async function transaction(fn: (db: Database) => void): Promise<void> {
  const database = await getDb();
  database.run("BEGIN;");
  try {
    fn(database);
    database.run("COMMIT;");
    markDirty();
  } catch (e) {
    try {
      database.run("ROLLBACK;");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export async function all<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
  const database = await getDb();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export async function getFirst<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await all<T>(sql, params);
  return rows.length ? rows[0] : null;
}

export async function run(sql: string, params: any[] = []): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    while (stmt.step()) {
      /* execute all statements */
    }
    markDirty();
  } finally {
    stmt.free();
  }
}

// execute several independent statements within one transaction (skip statements that fail)
export async function runMany(statements: Array<[string, any[]]>): Promise<void> {
  await transaction((database) => {
    for (const [sql, params] of statements) {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(params);
        while (stmt.step()) {
          /* execute */
        }
      } finally {
        stmt.free();
      }
    }
  });
}