'use strict';

exports.up = function(knex) {
    return knex.schema.createTable('held_bills', table => {
        table.increments('id').primary();
        table.integer('user_id').references('id').inTable('users').nullable();
        table.integer('slot').notNullable(); // 1, 2, or 3
        table.text('cart_json').notNullable();
        table.text('customer_id').nullable();
        table.text('customer_name').nullable();
        table.text('bill_discount').defaultTo('0');
        table.text('discount_type').defaultTo('flat');
        table.text('grand_total').defaultTo('0');
        table.integer('item_count').defaultTo(0);
        table.datetime('held_at').defaultTo(knex.fn.now());
    });
};

exports.down = function(knex) {
    return knex.schema.dropTableIfExists('held_bills');
};
