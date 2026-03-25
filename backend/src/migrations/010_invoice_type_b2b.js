/**
 * Migration 010 — Add invoice_mode and state_code to invoice_settings
 * for B2B Tax Invoice support (CGST+SGST slab-wise breakdown).
 */
'use strict';

exports.up = function (knex) {
    return knex.schema.hasTable('invoice_settings').then(exists => {
        if (!exists) return;
        return knex.raw(`PRAGMA table_info(invoice_settings)`).then(info => {
            const cols = info.map(c => c.name);
            const promises = [];
            if (!cols.includes('invoice_mode')) {
                promises.push(
                    knex.raw(`ALTER TABLE invoice_settings ADD COLUMN invoice_mode TEXT DEFAULT 'b2c'`)
                );
            }
            if (!cols.includes('state_code')) {
                promises.push(
                    knex.raw(`ALTER TABLE invoice_settings ADD COLUMN state_code TEXT DEFAULT ''`)
                );
            }
            return Promise.all(promises);
        });
    });
};

exports.down = function (knex) {
    // SQLite doesn't support DROP COLUMN in older versions — no-op
    return Promise.resolve();
};
