/**
 * Migration 012 — Add WhatsApp receipt toggle to invoice_settings
 * Adds: whatsapp_receipt_enabled (0/1, default 1 = enabled)
 */
'use strict';

exports.up = function (knex) {
  return knex.schema.hasTable('invoice_settings').then(exists => {
    if (!exists) return;
    return knex.raw(`PRAGMA table_info(invoice_settings)`).then(info => {
      const cols = info.map(c => c.name);
      if (!cols.includes('whatsapp_receipt_enabled')) {
        return knex.raw(
          `ALTER TABLE invoice_settings ADD COLUMN whatsapp_receipt_enabled INTEGER DEFAULT 1`
        );
      }
    });
  });
};

exports.down = function (knex) {
  // SQLite does not support DROP COLUMN — no-op
  return Promise.resolve();
};
