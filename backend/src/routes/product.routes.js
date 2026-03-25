'use strict';

const express = require('express');
const router = express.Router();
const bwipjs = require('bwip-js');
const db = require('../config/database');
const { logActivity } = require('../services/activity.service');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const {
    addProductOptions,
    getProductsOptions,
    updateProductOptions,
    deleteProductOptions,
    productByBarcodeOptions,
    getBarcodeOptions
} = require('../validators/product.validator');

// Ensure barcode column is indexed for fast scanner lookups
db.run(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`, () => { });

/**
 * Generates a system barcode if none supplied.
 * Format: BAR + last-8 digits of current ms timestamp.
 */
function generateBarcode() {
    return `BAR${Date.now().toString().slice(-8)}`;
}

router.post('/add-product', validate(addProductOptions), (req, res) => {
    const { name, cost_price, selling_price, stock_quantity, gst_percentage, low_stock_threshold, category_id, mrp, bulk_qty, bulk_discount } = req.body;

    // Use supplied barcode or auto-generate — supports both manufacturer & system barcodes
    const barcode = req.body.barcode || generateBarcode();
    db.run(`INSERT INTO products (name,barcode,category_id,cost_price,selling_price,mrp,stock_quantity,gst_percentage,low_stock_threshold,bulk_qty,bulk_discount)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [name, barcode, category_id, cost_price, selling_price, mrp, stock_quantity, gst_percentage, low_stock_threshold, bulk_qty, bulk_discount],
        function (err) {
            if (err) {
                const isDup = err.message.includes('UNIQUE');
                return apiResponse.error(res, isDup ? `Product "${name}" already exists` : 'Failed to add product', err, 400);
            }
            logActivity(req.user?.id, 'product_added', `Added product: ${name}`);
            return apiResponse.success(res, 'Product added successfully', { barcode, id: this.lastID }, 201);
        }
    );
});

router.get('/products', validate(getProductsOptions), (req, res) => {
    const { limit, offset, search } = req.query;

    let sql = `SELECT * FROM products`;
    const params = [];

    if (search) {
        sql += ` WHERE name LIKE ? OR barcode LIKE ?`;
        params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
        if (err) return apiResponse.error(res, 'Failed to fetch products', err, 500);
        return apiResponse.success(res, 'Products fetched successfully', { data: rows, limit, offset, hasMore: rows.length === limit });
    });
});

router.put('/update-product/:id', requireAdmin, validate(updateProductOptions), (req, res) => {
    const { name, cost_price, selling_price, stock_quantity, gst_percentage, low_stock_threshold, category_id, mrp, bulk_qty, bulk_discount } = req.body;
    db.run(`UPDATE products SET name=?,category_id=?,cost_price=?,selling_price=?,mrp=?,stock_quantity=?,gst_percentage=?,low_stock_threshold=?,bulk_qty=?,bulk_discount=? WHERE id=?`,
        [name, category_id, cost_price, selling_price, mrp, stock_quantity, gst_percentage, low_stock_threshold, bulk_qty, bulk_discount, req.params.id],
        function (err) {
            if (err) return apiResponse.error(res, 'Failed to update product', err, 500);
            if (this.changes === 0) return apiResponse.error(res, 'Product not found', null, 404);
            logActivity(req.user?.id, 'product_updated', `Updated product: ${name}`);
            return apiResponse.success(res, 'Product updated successfully');
        }
    );
});

router.delete('/delete-product/:id', requireAdmin, validate(deleteProductOptions), (req, res) => {
    db.run(`DELETE FROM products WHERE id=?`, [req.params.id], function (err) {
        if (err) {
            if (err.message.includes('FOREIGN KEY constraint failed')) {
                return apiResponse.error(res, 'Cannot delete product: It is used in existing sales or purchases.', err, 400);
            }
            return apiResponse.error(res, 'Failed to delete product', err, 500);
        }
        if (this.changes === 0) return apiResponse.error(res, 'Product not found', null, 404);
        logActivity(req.user?.id, 'product_deleted', `Deleted product ID: ${req.params.id}`);
        return apiResponse.success(res, 'Product deleted successfully');
    });
});


/**
 * GET /product-by-barcode/:code
 * POS scanner lookup — finds a product by exact barcode match.
 * Uses the idx_products_barcode index for O(log n) performance.
 */
router.get('/product-by-barcode/:code', validate(productByBarcodeOptions), (req, res) => {
    const code = req.params.code;
    db.get(`SELECT * FROM products WHERE barcode = ? LIMIT 1`, [code], (err, row) => {
        if (err) return apiResponse.error(res, 'Lookup failed', err, 500);
        if (!row) return apiResponse.error(res, 'Product not found', null, 404);
        return apiResponse.success(res, 'Product found', row);
    });
});

router.get('/barcode/:code', validate(getBarcodeOptions), async (req, res) => {
    try {
        const png = await bwipjs.toBuffer({ bcid: 'code128', text: req.params.code, scale: 3, height: 10, includetext: true, textxalign: 'center' });
        res.set('Content-Type', 'image/png'); res.send(png);
    } catch (err) {
        return apiResponse.error(res, 'Barcode generation failed', err, 500);
    }
});

router.get('/low-stock', (req, res) => {
    db.all(`SELECT * FROM products WHERE stock_quantity <= low_stock_threshold ORDER BY stock_quantity ASC`, [], (err, rows) => {
        if (err) return apiResponse.error(res, 'Failed to fetch low stock', err, 500);
        return apiResponse.success(res, 'Low stock fetched successfully', rows);
    });
});

module.exports = router;
