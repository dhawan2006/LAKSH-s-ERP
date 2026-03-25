'use strict';

const bcrypt = require('bcryptjs');

exports.up = async function (knex) {
    // Add manager_pin_hash column to invoice_settings
    await knex.schema.alterTable('invoice_settings', table => {
        table.text('manager_pin_hash').defaultTo(null);
    });

    // Generate bcrypt hash of default PIN '1234' (10 rounds) and store it
    const hash = bcrypt.hashSync('1234', 10);
    await knex('invoice_settings')
        .where({ id: 1 })
        .update({ manager_pin_hash: hash });
};

exports.down = async function (knex) {
    // SQLite doesn't support DROP COLUMN in older versions, but Knex handles it
    await knex.schema.alterTable('invoice_settings', table => {
        table.dropColumn('manager_pin_hash');
    });
};
