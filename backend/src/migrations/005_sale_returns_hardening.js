/**
 * Migration 005: Sale Returns Hardening
 * 
 * Adds columns to track who processed a return, which sale_item was returned,
 * and how many units of a sale_item have been returned.
 */

exports.up = function(knex) {
    return knex.schema
        .alterTable('sale_returns', table => {
            // Records which employee processed the return
            table.integer('user_id').nullable();
        })
        .alterTable('sale_return_items', table => {
            // Links each returned item back to the exact sale_items row
            table.integer('sale_item_id').nullable();
        })
        .alterTable('sale_items', table => {
            // Source of truth for how many units of each sale_item have been returned
            table.integer('returned_quantity').notNullable().defaultTo(0);
        });
};

exports.down = function(knex) {
    // In practice, exports.down can be a no-op returning Promise.resolve() 
    // since this is a forward-only hardening migration. SQLite ALTER TABLE DROP COLUMN
    // behavior can be tricky, so this is safer.
    return Promise.resolve();
};
