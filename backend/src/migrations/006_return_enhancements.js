'use strict';

exports.up = function(knex) {
    return knex.schema
        .alterTable('sale_return_items', table => {
            // 'resellable' | 'damaged' | 'expired'
            // Controls whether stock is restored. Only 'resellable' adds stock back.
            table.text('return_condition').defaultTo('resellable');
            // GST rate at time of return, needed for accurate GST reversal in reports
            table.real('gst_percentage').defaultTo(0);
        })
        .alterTable('invoice_settings', table => {
            // Return window in days. 0 = no limit. Default 7 days.
            table.integer('return_window_days').defaultTo(7);
        });
};

exports.down = function(knex) {
    return Promise.resolve();
};
