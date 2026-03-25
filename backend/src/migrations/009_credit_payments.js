'use strict';

exports.up = function(knex) {
    return knex.schema.createTable('credit_payments', table => {
        table.increments('id').primary();
        table.integer('customer_id').notNullable().references('id').inTable('customers');
        table.real('amount').notNullable();
        table.text('payment_mode').defaultTo('cash'); // 'cash' | 'upi'
        table.text('note').nullable();
        table.integer('recorded_by').references('id').inTable('users').nullable();
        table.datetime('created_at').defaultTo(knex.fn.now());
    });
};

exports.down = function(knex) {
    return knex.schema.dropTableIfExists('credit_payments');
};
