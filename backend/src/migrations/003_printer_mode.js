'use strict';

/**
 * Migration 003 — Add printer_mode column to invoice_settings
 *
 * 'printer_mode' is the unified field replacing the fragile
 * invoice_type + receipt_width combination.
 *
 * Values: 'thermal58' | 'thermal80' | 'a4'
 * Default: 'thermal80'
 */

exports.up = function (knex) {
    return knex.schema
        .table('invoice_settings', table => {
            table.text('printer_mode').defaultTo('thermal80');
        })
        .then(() => {
            // Seed existing rows — derive printer_mode from invoice_type / receipt_width
            return knex.raw(`
                UPDATE invoice_settings
                SET printer_mode = CASE
                    WHEN invoice_type = 'a4'           THEN 'a4'
                    WHEN receipt_width = '58mm'         THEN 'thermal58'
                    ELSE                                     'thermal80'
                END
                WHERE printer_mode IS NULL OR printer_mode = ''
            `);
        });
};

exports.down = function (knex) {
    return knex.schema.table('invoice_settings', table => {
        table.dropColumn('printer_mode');
    });
};
