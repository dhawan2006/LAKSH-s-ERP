/**
 * Migration 014 — Create WhatsApp send log table
 * Tracks every WhatsApp receipt send for future dashboards.
 */
'use strict';

exports.up = function (knex) {
    return knex.schema.hasTable('whatsapp_send_log').then(exists => {
        if (exists) return;
        return knex.schema.createTable('whatsapp_send_log', table => {
            table.increments('id').primary();
            table.integer('sale_id').notNullable();
            table.string('invoice_number').notNullable();
            table.string('customer_phone', 15);
            table.string('customer_name', 120);
            table.decimal('amount', 10, 2);
            table.timestamp('sent_at').defaultTo(knex.fn.now());
        });
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('whatsapp_send_log');
};
