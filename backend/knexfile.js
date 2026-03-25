'use strict';

const path = require('path');
let DB_PATH;

if (process.env.NODE_ENV === 'test') {
    DB_PATH = path.join(__dirname, 'billing_test.db');
} else {
    DB_PATH = path.join(__dirname, 'billing.db');
}

// Do NOT set journal_mode=WAL here. The raw sqlite3 connection in database.js
// already sets it. Two connections both issuing that PRAGMA simultaneously
// triggers SQLITE_BUSY. Instead we set a busy_timeout so Knex waits for any
// lock to clear rather than failing instantly.
const poolAfterCreate = (conn, cb) => {
    conn.run('PRAGMA busy_timeout = 10000', (err) => {
        if (err) return cb(err, conn);
        conn.run('PRAGMA foreign_keys = ON', cb);
    });
};

module.exports = {
    development: {
        client: 'sqlite3',
        connection: { filename: DB_PATH },
        useNullAsDefault: true,
        migrations: {
            directory: path.join(__dirname, 'src', 'migrations')
        },
        pool: { afterCreate: poolAfterCreate }
    },
    production: {
        client: 'sqlite3',
        connection: { filename: DB_PATH },
        useNullAsDefault: true,
        migrations: {
            directory: path.join(__dirname, 'src', 'migrations')
        },
        pool: { afterCreate: poolAfterCreate }
    }
};
