'use strict';

/**
 * Migration 004 — Idempotency cache table
 *
 * Stores processed Idempotency-Key values so that if the client
 * retries a POST /create-sale (e.g. after a network timeout),
 * the server returns the original response instead of creating
 * a duplicate sale.
 *
 * Rows are expired after 24 hours via a cleanup job in sale.routes.js.
 */

exports.up = function (knex) {
    return knex.schema.createTable('idempotency_cache', table => {
        table.text('idem_key').primary();          // The Idempotency-Key header value
        table.text('response_json').notNullable(); // Serialised success response
        table.datetime('created_at').defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('idempotency_cache');
};
