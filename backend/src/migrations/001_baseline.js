exports.up = function (knex) {
    return knex.schema
        .createTable('users', table => {
            table.increments('id').primary();
            table.text('name').notNullable();
            table.text('username').unique().notNullable();
            table.text('password_hash').notNullable();
            // SQLite does not strictly enforce ENUM via Knex in this way during table creation without raw CHECK, 
            // but we will use the native knex enums or text to represent it.
            table.text('role').notNullable();
            table.integer('must_change_password').defaultTo(1);
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('activity_logs', table => {
            table.increments('id').primary();
            table.integer('user_id').references('id').inTable('users');
            table.text('action').notNullable();
            table.text('details');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('categories', table => {
            table.increments('id').primary();
            table.text('name').unique().notNullable();
            table.text('description');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('products', table => {
            table.increments('id').primary();
            table.text('name').unique().notNullable();
            table.text('barcode').unique();
            table.integer('category_id').references('id').inTable('categories');
            table.real('cost_price').defaultTo(0);
            table.real('selling_price').notNullable();
            table.real('mrp').defaultTo(0);
            table.integer('stock_quantity').defaultTo(0);
            table.real('gst_percentage').defaultTo(0);
            table.integer('low_stock_threshold').defaultTo(5);
            table.integer('bulk_qty').defaultTo(0);
            table.real('bulk_discount').defaultTo(0);
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('customers', table => {
            table.increments('id').primary();
            table.text('name').notNullable();
            table.text('phone');
            table.text('address');
            table.real('credit_balance').defaultTo(0);
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('invoice_sequence', table => {
            table.integer('id').primary(); // manual check id=1
            table.integer('last_number').defaultTo(0);
        })
        .createTable('sales', table => {
            table.increments('id').primary();
            table.text('invoice_number').unique().notNullable();
            table.integer('customer_id').references('id').inTable('customers');
            table.real('total_amount').notNullable();
            table.real('gst_amount').defaultTo(0);
            table.real('bill_discount').defaultTo(0);
            table.text('discount_type').defaultTo('flat');
            table.real('final_amount').notNullable();
            table.real('cash_paid').defaultTo(0);
            table.real('upi_paid').defaultTo(0);
            table.real('credit_amount').defaultTo(0);
            table.text('status').defaultTo('COMPLETED');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('sale_items', table => {
            table.increments('id').primary();
            table.integer('sale_id').notNullable().references('id').inTable('sales');
            table.integer('product_id').references('id').inTable('products');
            table.integer('quantity').notNullable();
            table.real('price').notNullable();
            table.real('cost_price').defaultTo(0);
            table.real('discount').defaultTo(0);
        })
        .createTable('stock_adjustments', table => {
            table.increments('id').primary();
            table.integer('product_id').notNullable().references('id').inTable('products');
            table.text('adj_type').notNullable();
            table.integer('quantity').notNullable();
            table.text('note');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('po_sequence', table => {
            table.integer('id').primary();
            table.integer('last_number').defaultTo(0);
        })
        .createTable('purchase_orders', table => {
            table.increments('id').primary();
            table.text('po_number').unique().notNullable();
            table.text('supplier_name').notNullable();
            table.text('supplier_phone');
            table.real('total_amount').defaultTo(0);
            table.text('notes');
            table.text('status').defaultTo('PENDING');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('purchase_order_items', table => {
            table.increments('id').primary();
            table.integer('po_id').notNullable().references('id').inTable('purchase_orders');
            table.integer('product_id').references('id').inTable('products');
            table.integer('quantity').notNullable();
            table.real('purchase_price').defaultTo(0);
        })
        .createTable('purchase_sequence', table => {
            table.integer('id').primary();
            table.integer('last_number').defaultTo(0);
        })
        .createTable('purchases', table => {
            table.increments('id').primary();
            table.text('purchase_number').unique().notNullable();
            table.integer('po_id').references('id').inTable('purchase_orders');
            table.text('supplier_name').notNullable();
            table.text('supplier_phone');
            table.real('total_amount').defaultTo(0);
            table.real('cash_paid').defaultTo(0);
            table.real('credit_amount').defaultTo(0);
            table.text('notes');
            table.text('status').defaultTo('COMPLETED');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('purchase_items', table => {
            table.increments('id').primary();
            table.integer('purchase_id').notNullable().references('id').inTable('purchases');
            table.integer('product_id').references('id').inTable('products');
            table.integer('quantity').notNullable();
            table.real('purchase_price').defaultTo(0);
        })
        .createTable('pr_sequence', table => {
            table.integer('id').primary();
            table.integer('last_number').defaultTo(0);
        })
        .createTable('purchase_returns', table => {
            table.increments('id').primary();
            table.text('return_number').unique().notNullable();
            table.integer('purchase_id').references('id').inTable('purchases');
            table.real('total_amount').defaultTo(0);
            table.text('reason');
            table.text('status').defaultTo('COMPLETED');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('purchase_return_items', table => {
            table.increments('id').primary();
            table.integer('return_id').notNullable().references('id').inTable('purchase_returns');
            table.integer('product_id').references('id').inTable('products');
            table.integer('quantity').notNullable();
            table.real('purchase_price').defaultTo(0);
        })
        .createTable('so_sequence', table => {
            table.integer('id').primary();
            table.integer('last_number').defaultTo(0);
        })
        .createTable('sale_orders', table => {
            table.increments('id').primary();
            table.text('so_number').unique().notNullable();
            table.integer('customer_id').references('id').inTable('customers');
            table.real('total_amount').defaultTo(0);
            table.text('notes');
            table.date('valid_till');
            table.text('status').defaultTo('PENDING');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('sale_order_items', table => {
            table.increments('id').primary();
            table.integer('so_id').notNullable().references('id').inTable('sale_orders');
            table.integer('product_id').references('id').inTable('products');
            table.integer('quantity').notNullable();
            table.real('price').notNullable();
            table.real('discount').defaultTo(0);
        })
        .createTable('sr_sequence', table => {
            table.integer('id').primary();
            table.integer('last_number').defaultTo(0);
        })
        .createTable('sale_returns', table => {
            table.increments('id').primary();
            table.text('return_number').unique().notNullable();
            table.integer('sale_id').references('id').inTable('sales');
            table.real('total_amount').defaultTo(0);
            table.real('refund_cash').defaultTo(0);
            table.real('refund_upi').defaultTo(0);
            table.text('reason');
            table.text('status').defaultTo('COMPLETED');
            table.datetime('created_at').defaultTo(knex.fn.now());
        })
        .createTable('sale_return_items', table => {
            table.increments('id').primary();
            table.integer('return_id').notNullable().references('id').inTable('sale_returns');
            table.integer('product_id').references('id').inTable('products');
            table.integer('quantity').notNullable();
            table.real('price').defaultTo(0);
            table.real('discount').defaultTo(0);
        })
        .createTable('invoice_settings', table => {
            table.integer('id').primary(); // ID 1
            table.text('shop_name').defaultTo('Kirana Store');
            table.text('shop_address').defaultTo('');
            table.text('shop_phone').defaultTo('');
            table.text('gst_number').defaultTo('');
            table.text('logo_path').defaultTo('');
            table.text('invoice_type').defaultTo('thermal');
            table.text('receipt_width').defaultTo('80mm');
            table.integer('show_gst').defaultTo(1);
            table.integer('show_phone').defaultTo(1);
            table.integer('show_thank_you').defaultTo(1);
            table.integer('show_payment_details').defaultTo(1);
            table.text('invoice_prefix').defaultTo('INV-');
            table.integer('invoice_counter').defaultTo(0);
            table.text('thank_you_message').defaultTo('Thank you for shopping!');
            table.text('terms').defaultTo('Goods once sold will not be taken back.');
            table.datetime('updated_at').defaultTo(knex.fn.now());
        })
        .createTable('registers', table => {
            table.increments('id').primary();
            table.real('opening_cash').defaultTo(0);
            table.real('closing_cash').defaultTo(0);
            table.real('expected_cash').defaultTo(0);
            table.real('difference').defaultTo(0);
            table.text('operator_name').defaultTo('Store Admin');
            table.text('notes');
            table.text('status').defaultTo('OPEN');
            table.datetime('opened_at').defaultTo(knex.fn.now());
            table.datetime('closed_at');
        });
};

exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('registers')
        .dropTableIfExists('invoice_settings')
        .dropTableIfExists('sale_return_items')
        .dropTableIfExists('sale_returns')
        .dropTableIfExists('sr_sequence')
        .dropTableIfExists('sale_order_items')
        .dropTableIfExists('sale_orders')
        .dropTableIfExists('so_sequence')
        .dropTableIfExists('purchase_return_items')
        .dropTableIfExists('purchase_returns')
        .dropTableIfExists('pr_sequence')
        .dropTableIfExists('purchase_items')
        .dropTableIfExists('purchases')
        .dropTableIfExists('purchase_sequence')
        .dropTableIfExists('purchase_order_items')
        .dropTableIfExists('purchase_orders')
        .dropTableIfExists('po_sequence')
        .dropTableIfExists('stock_adjustments')
        .dropTableIfExists('sale_items')
        .dropTableIfExists('sales')
        .dropTableIfExists('invoice_sequence')
        .dropTableIfExists('customers')
        .dropTableIfExists('products')
        .dropTableIfExists('categories')
        .dropTableIfExists('activity_logs')
        .dropTableIfExists('users');
};
