exports.up = function (knex) {
    return knex.schema
        .alterTable('sales', table => {
            table.index('created_at', 'idx_sales_created_at');
        })
        .alterTable('customers', table => {
            table.index('phone', 'idx_customers_phone');
        })
        .alterTable('products', table => {
            table.index('name', 'idx_products_name');
        });
};

exports.down = function (knex) {
    return knex.schema
        .alterTable('products', table => {
            table.dropIndex('name', 'idx_products_name');
        })
        .alterTable('customers', table => {
            table.dropIndex('phone', 'idx_customers_phone');
        })
        .alterTable('sales', table => {
            table.dropIndex('created_at', 'idx_sales_created_at');
        });
};
