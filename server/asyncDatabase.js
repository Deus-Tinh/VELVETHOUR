import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { createPostgresPool, runPostgresMigrations } from './postgresDatabase.js';

class AsyncMutex {
  #tail = Promise.resolve();

  async run(work) {
    const previous = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }
}

export function toPostgresSql(sql) {
  let result = '';
  let parameter = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      result += char;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      result += char;
      if (char === '*' && next === '/') { result += next; index += 1; blockComment = false; }
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote) {
        if (next === quote) { result += next; index += 1; }
        else quote = null;
      } else if (char === '\\' && next) { result += next; index += 1; }
      continue;
    }
    if (char === '-' && next === '-') { result += char + next; index += 1; lineComment = true; continue; }
    if (char === '/' && next === '*') { result += char + next; index += 1; blockComment = true; continue; }
    if (char === "'" || char === '"') { quote = char; result += char; continue; }
    if (char === '?') { parameter += 1; result += `$${parameter}`; continue; }
    result += char;
  }

  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(result)) {
    result = result.replace(/^(\s*INSERT)\s+OR\s+IGNORE\s+INTO\b/i, '$1 INTO');
    const semicolon = result.trimEnd().endsWith(';');
    const body = semicolon ? result.trimEnd().slice(0, -1) : result;
    result = `${body} ON CONFLICT DO NOTHING${semicolon ? ';' : ''}`;
  }
  result = result.replace(/\bORDER\s+BY\s+rowid(\s+DESC)?\b/gi, (_match, direction = '') => `ORDER BY inserted_order${direction}`);
  return result;
}

class AsyncSqliteDatabase {
  constructor(raw) {
    this.raw = raw;
    this.async = true;
    this.isPostgres = false;
    this.#local = new AsyncLocalStorage();
  }

  #local;
  #mutex = new AsyncMutex();
  #savepoint = 0;

  #operation(work) {
    if (this.#local.getStore() === this) return Promise.resolve().then(work);
    return this.#mutex.run(work);
  }

  prepare(sql) {
    const statement = this.raw.prepare(sql);
    return {
      get: (...params) => this.#operation(() => statement.get(...params)),
      all: (...params) => this.#operation(() => statement.all(...params)),
      run: (...params) => this.#operation(() => statement.run(...params)),
    };
  }

  exec(sql) { return this.#operation(() => this.raw.exec(sql)); }

  async transaction(work, _options = {}) {
    if (this.#local.getStore() === this) {
      const savepoint = `serenity_sp_${++this.#savepoint}`;
      this.raw.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work();
        this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    }
    return this.#mutex.run(async () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await this.#local.run(this, work);
        this.raw.exec('COMMIT');
        return result;
      } catch (error) {
        this.raw.exec('ROLLBACK');
        throw error;
      }
    });
  }

  async health() {
    await this.prepare('SELECT 1 AS ok').get();
    return true;
  }

  async close() { return this.#mutex.run(() => this.raw.close()); }
}

class AsyncPostgresDatabase {
  constructor(pool) {
    this.pool = pool;
    this.async = true;
    this.isPostgres = true;
    this.#local = new AsyncLocalStorage();
  }

  #local;
  #savepoint = 0;

  async #query(sql, params = []) {
    const client = this.#local.getStore();
    const normalized = toPostgresSql(sql);
    return client ? client.query(normalized, params) : this.pool.query(normalized, params);
  }

  prepare(sql) {
    return {
      get: async (...params) => (await this.#query(sql, params)).rows[0],
      all: async (...params) => (await this.#query(sql, params)).rows,
      run: async (...params) => {
        const result = await this.#query(sql, params);
        return { changes: result.rowCount || 0, rowCount: result.rowCount || 0 };
      },
    };
  }

  async exec(sql) { await this.#query(sql); }

  async transaction(work, { advisoryLock } = {}) {
    const active = this.#local.getStore();
    if (active) {
      const savepoint = `serenity_sp_${++this.#savepoint}`;
      await active.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work();
        await active.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await active.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await active.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (advisoryLock) {
        const namespace = String(advisoryLock.namespace || 'serenity');
        const key = String(advisoryLock.key || '');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [namespace, key]);
      }
      const result = await this.#local.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    await this.pool.query('SELECT 1 AS ok');
    return true;
  }

  async close() { await this.pool.end(); }
}

export async function openAsyncDatabase({ databaseUrl = process.env.DATABASE_URL, sqlitePath } = {}) {
  if (String(databaseUrl || '').trim()) {
    const pool = createPostgresPool({ env: { ...process.env, DATABASE_URL: databaseUrl } });
    try {
      await runPostgresMigrations(pool);
      await pool.query('SELECT 1');
      return new AsyncPostgresDatabase(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  if (!sqlitePath) throw new Error('sqlitePath is required when DATABASE_URL is not configured.');
  const raw = new DatabaseSync(sqlitePath);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return wrapSqliteDatabase(raw);
}

export function wrapSqliteDatabase(raw) {
  return new AsyncSqliteDatabase(raw);
}
