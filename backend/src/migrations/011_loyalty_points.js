/**
 * Migration 011 — Loyalty Points System
 * Adds loyalty_points to customers, loyalty settings to invoice_settings,
 * and creates the loyalty_transactions log table.
 */
'use strict';

exports.up = function (knex) {
    return Promise.all([
        // Add loyalty_points to customers
        knex.raw(`PRAGMA table_info(customers)`).then(info => {
            const cols = info.map(c => c.name);
            if (!cols.includes('loyalty_points')) {
                return knex.raw(`ALTER TABLE customers ADD COLUMN loyalty_points INTEGER DEFAULT 0`);
            }
        }),

        // Add loyalty settings to invoice_settings
        knex.raw(`PRAGMA table_info(invoice_settings)`).then(info => {
            const cols = info.map(c => c.name);
            const promises = [];
            if (!cols.includes('loyalty_enabled')) {
                promises.push(knex.raw(`ALTER TABLE invoice_settings ADD COLUMN loyalty_enabled INTEGER DEFAULT 0`));
            }
            if (!cols.includes('loyalty_earn_rate')) {
                promises.push(knex.raw(`ALTER TABLE invoice_settings ADD COLUMN loyalty_earn_rate REAL DEFAULT 1`));
            }
            if (!cols.includes('loyalty_redeem_rate')) {
                promises.push(knex.raw(`ALTER TABLE invoice_settings ADD COLUMN loyalty_redeem_rate REAL DEFAULT 1`));
            }
            if (!cols.includes('loyalty_min_redeem')) {
                promises.push(knex.raw(`ALTER TABLE invoice_settings ADD COLUMN loyalty_min_redeem INTEGER DEFAULT 10`));
            }
            return Promise.all(promises);
        }),

        // Create loyalty_transactions table
        knex.schema.hasTable('loyalty_transactions').then(exists => {
            if (exists) return;
            return knex.schema.createTable('loyalty_transactions', table => {
                table.increments('id').primary();
                table.integer('customer_id').notNullable();
                table.integer('sale_id').nullable();
                table.text('type').notNullable(); // 'earn' | 'redeem' | 'adjust'
                table.integer('points').notNullable();
                table.text('note').nullable();
                table.datetime('created_at').defaultTo(knex.fn.now());
            });
        })
    ]);
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('loyalty_transactions');
    // SQLite doesn't support DROP COLUMN in older versions for the other changes
};
