/**
 * Purchase Routes — Purchase orders, purchases, purchase returns
 * POST /add-purchase-order       — Create a new purchase order
 * GET  /purchase-orders          — List all purchase orders
 * PUT  /receive-purchase/:id     — Receive a purchase order (converts to purchase)
 * POST /add-purchase             — Direct purchase (without PO)
 * GET  /purchases                — List all purchases
 * POST /purchase-return          — Create a purchase return
 * GET  /purchase-returns         — List all purchase returns
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { run, get, all } = require('../utils/db-promise');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const {
    addPurchaseOrderOptions,
    getPurchaseOrdersOptions,
    getPurchaseOrderItemsOptions,
    receivePurchaseOptions,
    addPurchaseOptions,
    getPurchasesOptions,
    getPurchaseItemsOptions,
    purchaseReturnOptions,
    getPurchaseReturnsOptions
} = require('../validators/purchase.validator');

/* ── Purchase Orders ─────────────────────────────────────────── */
router.post('/add-purchase-order', validate(addPurchaseOrderOptions), async (req, res) => {
    const { supplier_name, supplier_phone, items, notes } = req.body;

    try {
        await run('BEGIN IMMEDIATE TRANSACTION');
        const seqRow = await get('SELECT last_number FROM po_sequence WHERE id = 1');
        const newNum = (seqRow?.last_number || 0) + 1;
        await run('UPDATE po_sequence SET last_number = ? WHERE id = 1', [newNum]);
        const poNumber = `PO-${String(newNum).padStart(5, '0')}`;

        let totalAmount = 0;
        for (const item of items) {
            totalAmount += (item.quantity || 0) * (item.purchase_price || 0);
        }

        const res2 = await run(
            `INSERT INTO purchase_orders (po_number, supplier_name, supplier_phone, total_amount, notes, status)
             VALUES (?, ?, ?, ?, ?, 'PENDING')`,
            [poNumber, supplier_name || 'Unknown', supplier_phone || null, totalAmount, notes || null]
        );
        const poId = res2.lastID;

        for (const item of items) {
            const product = await get('SELECT id, name FROM products WHERE id = ?', [item.product_id]);
            if (!product) throw new Error(`Product #${item.product_id} not found`);
            await run(
                `INSERT INTO purchase_order_items (po_id, product_id, quantity, purchase_price)
                 VALUES (?, ?, ?, ?)`,
                [poId, item.product_id, item.quantity, item.purchase_price || 0]
            );
        }

        await run('COMMIT');
        return apiResponse.success(res, 'Purchase order created', { po_number: poNumber, id: poId }, 201);
    } catch (err) {
        await run('ROLLBACK').catch(() => { });
        return apiResponse.error(res, err.message || 'Failed to create purchase order', err, 500);
    }
});

router.get('/purchase-orders', validate(getPurchaseOrdersOptions), (req, res) => {
    const { limit, offset } = req.query;

    db.all(
        `SELECT po.*, 
                (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.po_id = po.id) AS item_count,
                DATETIME(po.created_at, 'localtime') AS created_at_local
         FROM purchase_orders po ORDER BY po.id DESC LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch purchase orders', err, 500);
            return apiResponse.success(res, 'Purchase orders fetched successfully', { data: rows, limit, offset, hasMore: rows.length === limit });
        }
    );
});

router.get('/purchase-order-items/:id', validate(getPurchaseOrderItemsOptions), (req, res) => {
    db.all(
        `SELECT poi.*, p.name AS product_name
         FROM purchase_order_items poi
         LEFT JOIN products p ON p.id = poi.product_id
         WHERE poi.po_id = ?`,
        [req.params.id],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch items', err, 500);
            return apiResponse.success(res, 'Purchase order items fetched', rows);
        }
    );
});

/* ── Receive Purchase Order → Creates Purchase ──────────────── */
router.put('/receive-purchase/:id', validate(receivePurchaseOptions), async (req, res) => {
    const poId = req.params.id;
    const { cash_paid, credit_amount, notes } = req.body;

    try {
        await run('BEGIN IMMEDIATE TRANSACTION');
        const po = await get('SELECT * FROM purchase_orders WHERE id = ?', [poId]);
        if (!po) throw new Error('Purchase order not found');
        if (po.status === 'RECEIVED') throw new Error('Purchase order already received');

        const items = await all('SELECT * FROM purchase_order_items WHERE po_id = ?', [poId]);

        // Generate purchase number
        const seqRow = await get('SELECT last_number FROM purchase_sequence WHERE id = 1');
        const newNum = (seqRow?.last_number || 0) + 1;
        await run('UPDATE purchase_sequence SET last_number = ? WHERE id = 1', [newNum]);
        const purNumber = `PUR-${String(newNum).padStart(5, '0')}`;

        const purRes = await run(
            `INSERT INTO purchases (purchase_number, po_id, supplier_name, supplier_phone, total_amount, cash_paid, credit_amount, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`,
            [purNumber, poId, po.supplier_name, po.supplier_phone, po.total_amount, cash_paid, credit_amount, notes || null]
        );
        const purId = purRes.lastID;

        for (const item of items) {
            await run(
                `INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price)
                 VALUES (?, ?, ?, ?)`,
                [purId, item.product_id, item.quantity, item.purchase_price]
            );
            // Update stock and cost price
            await run(
                `UPDATE products SET stock_quantity = stock_quantity + ?, cost_price = ? WHERE id = ?`,
                [item.quantity, item.purchase_price, item.product_id]
            );
        }

        await run(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = ?`, [poId]);
        await run('COMMIT');
        return apiResponse.success(res, 'Purchase received', { purchase_number: purNumber, id: purId });
    } catch (err) {
        await run('ROLLBACK').catch(() => { });
        return apiResponse.error(res, err.message || 'Failed to receive purchase', err, 500);
    }
});

/* ── Direct Purchase (no PO) ─────────────────────────────────── */
router.post('/add-purchase', validate(addPurchaseOptions), async (req, res) => {
    const { supplier_name, supplier_phone, items, cash_paid, credit_amount, notes } = req.body;

    try {
        await run('BEGIN IMMEDIATE TRANSACTION');
        const seqRow = await get('SELECT last_number FROM purchase_sequence WHERE id = 1');
        const newNum = (seqRow?.last_number || 0) + 1;
        await run('UPDATE purchase_sequence SET last_number = ? WHERE id = 1', [newNum]);
        const purNumber = `PUR-${String(newNum).padStart(5, '0')}`;

        let totalAmount = 0;
        for (const item of items) totalAmount += item.quantity * item.purchase_price;

        const purRes = await run(
            `INSERT INTO purchases (purchase_number, supplier_name, supplier_phone, total_amount, cash_paid, credit_amount, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`,
            [purNumber, supplier_name || 'Unknown', supplier_phone || null, totalAmount, cash_paid, credit_amount, notes || null]
        );
        const purId = purRes.lastID;

        for (const item of items) {
            const product = await get('SELECT * FROM products WHERE id = ?', [item.product_id]);
            if (!product) throw new Error(`Product #${item.product_id} not found`);
            await run(
                `INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price)
                 VALUES (?, ?, ?, ?)`,
                [purId, item.product_id, item.quantity, item.purchase_price]
            );
            await run(
                `UPDATE products SET stock_quantity = stock_quantity + ?, cost_price = ? WHERE id = ?`,
                [item.quantity, item.purchase_price, item.product_id]
            );
        }

        await run('COMMIT');
        return apiResponse.success(res, 'Purchase recorded', { purchase_number: purNumber, id: purId }, 201);
    } catch (err) {
        await run('ROLLBACK').catch(() => { });
        return apiResponse.error(res, err.message || 'Failed to record purchase', err, 500);
    }
});

router.get('/purchases', validate(getPurchasesOptions), (req, res) => {
    const { limit, offset } = req.query;

    db.all(
        `SELECT p.*, DATETIME(p.created_at, 'localtime') AS created_at_local,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
         FROM purchases p ORDER BY p.id DESC LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch purchases', err, 500);
            return apiResponse.success(res, 'Purchases fetched successfully', { data: rows, limit, offset, hasMore: rows.length === limit });
        }
    );
});

router.get('/purchase-items/:id', validate(getPurchaseItemsOptions), (req, res) => {
    db.all(
        `SELECT pi.*, p.name AS product_name
         FROM purchase_items pi LEFT JOIN products p ON p.id = pi.product_id
         WHERE pi.purchase_id = ?`,
        [req.params.id],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch items', err, 500);
            return apiResponse.success(res, 'Purchase items fetched successfully', rows);
        }
    );
});

/* ── Purchase Return ─────────────────────────────────────────── */
router.post('/purchase-return', validate(purchaseReturnOptions), async (req, res) => {
    const { purchase_id, items, reason } = req.body;

    try {
        await run('BEGIN IMMEDIATE TRANSACTION');
        const seqRow = await get('SELECT last_number FROM pr_sequence WHERE id = 1');
        const newNum = (seqRow?.last_number || 0) + 1;
        await run('UPDATE pr_sequence SET last_number = ? WHERE id = 1', [newNum]);
        const prNumber = `PR-${String(newNum).padStart(5, '0')}`;

        let totalAmount = 0;
        for (const item of items) totalAmount += item.quantity * item.purchase_price;

        const prRes = await run(
            `INSERT INTO purchase_returns (return_number, purchase_id, total_amount, reason, status)
             VALUES (?, ?, ?, ?, 'COMPLETED')`,
            [prNumber, purchase_id || null, totalAmount, reason || null]
        );
        const prId = prRes.lastID;

        for (const item of items) {
            await run(
                `INSERT INTO purchase_return_items (return_id, product_id, quantity, purchase_price)
                 VALUES (?, ?, ?, ?)`,
                [prId, item.product_id, item.quantity, item.purchase_price]
            );
            // Deduct returned stock
            await run(
                `UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?`,
                [item.quantity, item.product_id]
            );
        }

        await run('COMMIT');
        return apiResponse.success(res, 'Purchase return recorded', { return_number: prNumber, id: prId }, 201);
    } catch (err) {
        await run('ROLLBACK').catch(() => { });
        return apiResponse.error(res, err.message || 'Failed to record purchase return', err, 500);
    }
});

router.get('/purchase-returns', validate(getPurchaseReturnsOptions), (req, res) => {
    const { limit, offset } = req.query;

    db.all(
        `SELECT pr.*, DATETIME(pr.created_at, 'localtime') AS created_at_local,
                (SELECT COUNT(*) FROM purchase_return_items pri WHERE pri.return_id = pr.id) AS item_count
         FROM purchase_returns pr ORDER BY pr.id DESC LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch purchase returns', err, 500);
            return apiResponse.success(res, 'Purchase returns fetched successfully', { data: rows, limit, offset, hasMore: rows.length === limit });
        }
    );
});

module.exports = router;
