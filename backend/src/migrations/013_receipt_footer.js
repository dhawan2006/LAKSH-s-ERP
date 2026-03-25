/**
 * Migration 013 — Add configurable receipt footer to invoice_settings
 * Adds: receipt_footer (TEXT, default 'Sent from Kirana ERP')
 */
'use strict';

exports.up = function (knex) {
    return knex.schema.hasTable('invoice_settings').then(exists => {
        if (!exists) return;
        return knex.raw('PRAGMA table_info(invoice_settings)').then(info => {
            const cols = info.map(c => c.name);
            if (!cols.includes('receipt_footer')) {
                return knex.raw(
                    `ALTER TABLE invoice_settings ADD COLUMN receipt_footer TEXT DEFAULT 'Sent from Kirana ERP'`
                );
            }
        });
    });
};

exports.down = function (knex) {
    return Promise.resolve();
};
