'use strict';

/**
 * IMPORTANT: Do NOT require('./database') here at the top level.
 * database.js opens a raw sqlite3 connection immediately on require().
 * If that happens in the same tick as Knex opening its pool, both try to
 * set PRAGMA journal_mode = WAL simultaneously → SQLITE_BUSY crash.
 * Instead we compute DB_PATH directly without opening any connection.
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const knex = require('knex');
const knexConfig = require('../../knexfile.js');

function getDbPath() {
    if (process.env.NODE_ENV === 'test') {
        return path.join(__dirname, '../../billing_test.db');
    }
    return path.join(__dirname, '../../billing.db');
}

function createBackup(dbPath) {
    if (!fs.existsSync(dbPath)) return;

    const date = new Date();
    const timestamp = date.getFullYear().toString() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0') + '_' +
        String(date.getHours()).padStart(2, '0') +
        String(date.getMinutes()).padStart(2, '0');

    const backupDir = path.dirname(dbPath);
    const backupPath = path.join(backupDir, `billing_backup_${timestamp}.db`);

    try {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`✅ Database backup created at: ${backupPath}`);
    } catch (err) {
        console.error('❌ Failed to create database backup:', err);
        throw err;
    }
}

async function initializeDatabase() {
    return new Promise(async (resolve, reject) => {
        let dbInstance;
        try {
            const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
            const dbPath = getDbPath();

            // 1. Create a DB Backup before doing anything
            if (process.env.NODE_ENV !== 'test') { // Don't backup test DB
                createBackup(dbPath);
            }

            dbInstance = knex(knexConfig[env]);

            // 2. Check if this is an existing database without migrations
            const hasUsers = await dbInstance.schema.hasTable('users');
            const hasMigrations = await dbInstance.schema.hasTable('knex_migrations');

            if (hasUsers && !hasMigrations) {
                console.log('🔄 Existing populated database detected. Marking baseline as executed...');

                // Create migrations table manually
                await dbInstance.schema.createTable('knex_migrations', table => {
                    table.increments('id').primary();
                    table.string('name');
                    table.integer('batch');
                    table.timestamp('migration_time');
                });

                await dbInstance.schema.createTable('knex_migrations_lock', table => {
                    table.integer('index').primary();
                    table.integer('is_locked');
                });

                await dbInstance('knex_migrations_lock').insert({ index: 1, is_locked: 0 });

                // Legacy databases might not have invoice_settings
                const hasInvoiceSettings = await dbInstance.schema.hasTable('invoice_settings');
                if (!hasInvoiceSettings) {
                    await dbInstance.schema.createTable('invoice_settings', table => {
                        table.increments('id').primary();
                        table.string('shop_name').defaultTo('Kirana Store');
                        table.string('shop_address').nullable();
                        table.string('shop_phone').nullable();
                        table.string('gst_number').nullable();
                        table.string('invoice_type').defaultTo('thermal');
                        table.string('receipt_width').defaultTo('80mm');
                        table.string('printer_mode').defaultTo('thermal80');
                        table.string('logo_path').nullable();
                        table.boolean('show_gst').defaultTo(true);
                        table.boolean('show_phone').defaultTo(true);
                        table.boolean('show_thank_you').defaultTo(true);
                        table.boolean('show_payment_details').defaultTo(true);
                        table.string('invoice_prefix').defaultTo('INV-');
                        table.integer('invoice_counter').defaultTo(0);
                        table.string('thank_you_message').defaultTo('Thank you for shopping!');
                        table.string('terms').defaultTo('Goods once sold will not be taken back.');
                        table.timestamp('updated_at').defaultTo(dbInstance.fn.now());
                    });
                    await dbInstance('invoice_settings').insert({ id: 1, printer_mode: 'thermal80' });
                }

                // Legacy databases might not have registers
                const hasRegistersLegacy = await dbInstance.schema.hasTable('registers');
                if (!hasRegistersLegacy) {
                    await dbInstance.schema.createTable('registers', table => {
                        table.increments('id').primary();
                        table.real('opening_cash').defaultTo(0);
                        table.real('closing_cash').defaultTo(0);
                        table.real('expected_cash').defaultTo(0);
                        table.real('difference').defaultTo(0);
                        table.text('operator_name').defaultTo('Store Admin');
                        table.text('notes');
                        table.text('status').defaultTo('OPEN');
                        table.datetime('opened_at').defaultTo(dbInstance.fn.now());
                        table.datetime('closed_at');
                    });
                }


                // Mark 001_baseline.js and 002_indexes.js as executed
                await dbInstance('knex_migrations').insert([
                    { name: '001_baseline.js', batch: 1, migration_time: new Date() },
                    { name: '002_indexes.js', batch: 1, migration_time: new Date() }
                ]);
            }

            // 3. Run Knex Migrations
            console.log('🚀 Running Knex migrations...');
            await dbInstance.migrate.latest();
            console.log('✅ Knex migrations completed successfully.');

            // Legacy databases might not have invoice_settings or registers because 001_baseline.js was modified later
            const hasInvoiceSettings = await dbInstance.schema.hasTable('invoice_settings');
            if (!hasInvoiceSettings) {
                await dbInstance.schema.createTable('invoice_settings', table => {
                    table.increments('id').primary();
                    table.string('shop_name').defaultTo('Kirana Store');
                    table.string('shop_address').nullable();
                    table.string('shop_phone').nullable();
                    table.string('gst_number').nullable();
                    table.string('invoice_type').defaultTo('thermal');
                    table.string('receipt_width').defaultTo('80mm');
                    table.string('printer_mode').defaultTo('thermal80');
                    table.string('logo_path').nullable();
                    table.boolean('show_gst').defaultTo(true);
                    table.boolean('show_phone').defaultTo(true);
                    table.boolean('show_thank_you').defaultTo(true);
                    table.boolean('show_payment_details').defaultTo(true);
                    table.string('invoice_prefix').defaultTo('INV-');
                    table.integer('invoice_counter').defaultTo(0);
                    table.string('thank_you_message').defaultTo('Thank you for shopping!');
                    table.string('terms').defaultTo('Goods once sold will not be taken back.');
                    table.timestamp('updated_at').defaultTo(dbInstance.fn.now());
                });
            }

            const hasRegisters = await dbInstance.schema.hasTable('registers');
            if (!hasRegisters) {
                await dbInstance.schema.createTable('registers', table => {
                    table.increments('id').primary();
                    table.real('opening_cash').defaultTo(0);
                    table.real('closing_cash').defaultTo(0);
                    table.real('expected_cash').defaultTo(0);
                    table.real('difference').defaultTo(0);
                    table.text('operator_name').defaultTo('Store Admin');
                    table.text('notes');
                    table.text('status').defaultTo('OPEN');
                    table.datetime('opened_at').defaultTo(dbInstance.fn.now());
                    table.datetime('closed_at');
                });
            }

            // 4. Seed default users
            const adminHash = await bcrypt.hash('admin123', 12);
            const workerHash = await bcrypt.hash('worker123', 12);

            const adminExists = await dbInstance('users').where({ username: 'admin' }).first();
            if (!adminExists) {
                await dbInstance('users').insert({
                    name: 'Laksh',
                    username: 'admin',
                    password_hash: adminHash,
                    role: 'admin'
                });
            }

            const workerExists = await dbInstance('users').where({ username: 'worker1' }).first();
            if (!workerExists) {
                await dbInstance('users').insert({
                    name: 'Worker One',
                    username: 'worker1',
                    password_hash: workerHash,
                    role: 'worker'
                });
            }

            const sequenceNames = ['invoice_sequence', 'po_sequence', 'purchase_sequence', 'pr_sequence', 'so_sequence', 'sr_sequence'];
            for (const seq of sequenceNames) {
                const seqExists = await dbInstance(seq).where({ id: 1 }).first();
                if (!seqExists) {
                    await dbInstance(seq).insert({ id: 1, last_number: 0 });
                }
            }

            const invoiceSettingsExists = await dbInstance('invoice_settings').where({ id: 1 }).first();
            if (!invoiceSettingsExists) {
                await dbInstance('invoice_settings').insert({ id: 1, printer_mode: 'thermal80' });
            }

            // Important: Destroy Knex instance to release SQLite DB lock, especially for tests.
            await dbInstance.destroy();
            resolve();
        } catch (err) {
            console.error('❌ Migration failed:', err);
            // Attempt to destroy on error as well
            if (typeof dbInstance !== 'undefined') {
                try { await dbInstance.destroy(); } catch (e) {}
            }
            reject(err);
        }
    });
}

module.exports = initializeDatabase;
