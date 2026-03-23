// Node 22.5+ 内置 sqlite，无需编译原生模块
import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(__dirname, '../../data/hsp.db')

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    _db = new DatabaseSync(DB_PATH)
    initSchema(_db)
  }
  return _db
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      stream_id    TEXT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'pending',
      tx_hash      TEXT,
      hsp_message  TEXT,
      req_tx       TEXT,
      conf_tx      TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS recurring_rules (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id      TEXT NOT NULL,
      recipient      TEXT NOT NULL,
      amount         REAL NOT NULL,
      currency       TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      memo           TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      next_run_at    INTEGER
    );
  `)
}
