/**
 * SQLite Database Connection
 * Exports a single shared db instance with WAL mode and foreign keys enabled.
 */

'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let DB_PATH;

if (process.env.NODE_ENV === 'test') {
    DB_PATH = path.join(__dirname, '../../billing_test.db');
} else {
    DB_PATH = path.join(__dirname, '../../billing.db');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to SQLite database at:', DB_PATH);
});

// Serialize so each PRAGMA fully completes before the next one starts.
// busy_timeout must be first so all subsequent operations wait for locks
// instead of throwing SQLITE_BUSY immediately.
db.serialize(() => {
    db.run('PRAGMA busy_timeout = 10000');
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
});

db.DB_PATH = DB_PATH;
module.exports = db;
