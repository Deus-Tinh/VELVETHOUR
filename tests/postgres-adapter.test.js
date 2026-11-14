import test from 'node:test';
import assert from 'node:assert/strict';
import { toPostgresSql } from '../server/asyncDatabase.js';

test('SQLite positional parameters convert without touching quoted text or comments', () => {
  const sql = `SELECT '?' AS literal, value FROM records WHERE id = ? AND note = 'it''s ?' -- ? stays a comment\nAND active = ?`;
  assert.equal(toPostgresSql(sql), `SELECT '?' AS literal, value FROM records WHERE id = $1 AND note = 'it''s ?' -- ? stays a comment\nAND active = $2`);
});

test('rowid ordering maps to stable PostgreSQL insertion order for both directions', () => {
  assert.equal(toPostgresSql('SELECT * FROM collection_records ORDER BY rowid'),
    'SELECT * FROM collection_records ORDER BY inserted_order');
  assert.equal(toPostgresSql('SELECT * FROM chat_messages ORDER BY rowid DESC LIMIT ?'),
    'SELECT * FROM chat_messages ORDER BY inserted_order DESC LIMIT $1');
});

test('INSERT OR IGNORE becomes PostgreSQL ON CONFLICT DO NOTHING', () => {
  assert.equal(toPostgresSql('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?);'),
    'INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT DO NOTHING;');
});
