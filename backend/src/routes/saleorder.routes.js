/**
 * Sale Order & Sale Return Routes
 * POST /add-sale-order      — Create a new sale order (quotation)
 * GET  /sale-orders         — List all sale orders
 * PUT  /convert-sale-order/:id — Convert sale order → actual sale
 * POST /sale-return         — Process a sale return
 * GET  /sale-returns        — List all sale returns
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { run, get } = require('../utils/db-promise');
const { createSale } = require('../services/sale.service');
const { logActivity } = require('../services/activity.service');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const {
    addSaleOrderOptions,
    getSaleOrderItemsOptions,
    convertSaleOrderOptions,
    saleReturnOptions,
    getSaleReturnDetailOptions
} = require('../validators/saleorder.validator');

/* ── Sale Orders ─────────────────────────────────────────────── */
router.post('/add-sale-order', validate(addSaleOrderOptions), async (req, res) => {
    const { customer_id, items, notes, valid_till } = req.body;

    try {
        await run('BEGIN IMMEDIATE TRANSACTION');
        const seqRow = await get('SELECT last_number FROM so_sequence WHERE id = 1');
        const newNum = (seqRow?.last_number || 0) + 1;
        await run('UPDATE so_sequence SET last_number = ? WHERE id = 1', [newNum]);
        const soNumber = `SO-${String(newNum).padStart(5, '0')}`;

        let totalAmount = 0;
        for (const item of items) {
            totalAmount += (item.quantity || 0) * (item.price || 0) * (1 - (item.discount || 0) / 100);
        }

        const soRes = await run(
            `INSERT INTO sale_orders (so_number, customer_id, total_amount, notes, valid_till, status)
             VALUES (?, ?, ?, ?, ?, 'PENDING')`,
            [soNumber, customer_id || null, totalAmount, notes || null, valid_till || null]
        );
        const soId = soRes.lastID;

        for (const item of items) {
            const product = await get('SELECT id FROM products WHERE id = ?', [item.product_id]);
            if (!product) throw new Error(`Product #${item.product_id} not found`);
            await run(
                `INSERT INTO sale_order_items (so_id, product_id, quantity, price, discount)
                 VALUES (?, ?, ?, ?, ?)`,
                [soId, item.product_id, item.quantity, item.price || 0, item.discount || 0]
            );
        }

        await run('COMMIT');
        return apiResponse.success(res, 'Sale order created', { so_number: soNumber, id: soId }, 201);
    } catch (err) {
        await run('ROLLBACK').catch(() => { });
        return apiResponse.error(res, err.message || 'Failed to create sale order', err, 500);
    }
});

router.get('/sale-orders', (req, res) => {
    db.all(
        `SELECT so.*, c.name AS customer_name,
                DATETIME(so.created_at, 'localtime') AS created_at_local,
                (SELECT COUNT(*) FROM sale_order_items soi WHERE soi.so_id = so.id) AS item_count
         FROM sale_orders so LEFT JOIN customers c ON c.id = so.customer_id
         ORDER BY so.id DESC`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch sale orders', err, 500);
            return apiResponse.success(res, 'Sale orders fetched', rows);
        }
    );
});

router.get('/sale-order-items/:id', validate(getSaleOrderItemsOptions), (req, res) => {
    db.all(
        `SELECT soi.*, p.name AS product_name
         FROM sale_order_items soi LEFT JOIN products p ON p.id = soi.product_id
         WHERE soi.so_id = ?`,
        [req.params.id],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch items', err, 500);
            return apiResponse.success(res, 'Sale order items fetched', rows);
        }
    );
});

/* ── Convert Sale Order → Sale ───────────────────────────────── */
router.put('/convert-sale-order/:id', validate(convertSaleOrderOptions), async (req, res) => {
    const soId = req.params.id;
    const { cash_paid, upi_paid, bill_discount, discount_type } = req.body;

    try {
        const so = await get('SELECT * FROM sale_orders WHERE id = ?', [soId]);
        if (!so) return apiResponse.error(res, 'Sale order not found', null, 404);
        if (so.status !== 'PENDING') return apiResponse.error(res, 'Sale order already converted or cancelled', null, 400);

        const soItems = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM sale_order_items WHERE so_id = ?', [soId], (err, rows) => {
                err ? reject(err) : resolve(rows);
            });
        });

        const saleData = {
            customer_id: so.customer_id,
            items: soItems.map(i => ({ product_id: i.product_id, quantity: i.quantity, discount: i.discount })),
            cash_paid,
            upi_paid,
            bill_discount,
            discount_type,
        };

        const result = await createSale(saleData);

        await run(`UPDATE sale_orders SET status = 'CONVERTED' WHERE id = ?`, [soId]);
        return apiResponse.success(res, 'Sale order converted to sale', result);
    } catch (err) {
        return apiResponse.error(res, err.error || err.message || 'Conversion failed', err, 500);
    }
});

/* ── Returnable Items for an Invoice ────────────────────────── */
router.get('/sale/:id/returnable-items', async (req, res) => {
    const saleId = parseInt(req.params.id);
    if (!saleId) return apiResponse.error(res, 'Invalid sale ID', null, 400);

    try {
        const sale = await get(
            `SELECT s.id, s.invoice_number, s.final_amount, s.cash_paid, s.upi_paid,
                    s.credit_amount, s.created_at, c.name AS customer_name
             FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
             WHERE s.id = ?`,
            [saleId]
        );
        if (!sale) return apiResponse.error(res, 'Sale not found', null, 404);

        // Check return window (fetch from settings)
        const settings = await get('SELECT return_window_days FROM invoice_settings WHERE id = 1');
        const windowDays = settings?.return_window_days ?? 7;
        if (windowDays > 0) {
            const saleDate = new Date(sale.created_at);
            const daysDiff = Math.floor((Date.now() - saleDate.getTime()) / 86400000);
            if (daysDiff > windowDays) {
                return apiResponse.error(
                    res,
                    `Return window of ${windowDays} day(s) has expired. Sale was ${daysDiff} days ago.`,
                    null,
                    400
                );
            }
        }

        // Get items with return tracking
        const items = await new Promise((resolve, reject) => {
            db.all(
                `SELECT si.id AS sale_item_id,
                        si.product_id,
                        p.name AS product_name,
                        si.quantity AS sold_qty,
                        COALESCE(si.returned_quantity, 0) AS already_returned,
                        (si.quantity - COALESCE(si.returned_quantity, 0)) AS remaining_qty,
                        si.price,
                        si.discount,
                        COALESCE(p.gst_percentage, 0) AS gst_percentage
                 FROM sale_items si
                 LEFT JOIN products p ON p.id = si.product_id
                 WHERE si.sale_id = ?`,
                [saleId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        return apiResponse.success(res, 'Returnable items fetched', {
            sale,
            items: items.filter(i => i.remaining_qty > 0),
            all_items: items
        });
    } catch (err) {
        return apiResponse.error(res, err.message || 'Failed to fetch returnable items', err, 500);
    }
});

/* ── Sale Return ─────────────────────────────────────────────── */
router.post('/sale-return', validate(saleReturnOptions), async (req, res) => {
    const { sale_id, items, reason, refund_cash, refund_upi } = req.body;
    const processedBy = req.user?.id || null;

    try {
        await run('BEGIN IMMEDIATE TRANSACTION');

        // ── 1. Validate sale exists if sale_id provided ──────────────────────
        let originalSale = null;
        if (sale_id) {
            originalSale = await get('SELECT * FROM sales WHERE id = ?', [sale_id]);
            if (!originalSale) {
                await run('ROLLBACK');
                return apiResponse.error(res, `Sale #${sale_id} not found`, null, 404);
            }

            // ── 1c. Return window check ──────────────────────────────────────
            const settings = await get('SELECT return_window_days FROM invoice_settings WHERE id = 1');
            const windowDays = settings?.return_window_days ?? 7;
            if (windowDays > 0) {
                const saleDate = new Date(originalSale.created_at);
                const daysDiff = Math.floor((Date.now() - saleDate.getTime()) / 86400000);
                if (daysDiff > windowDays) {
                    await run('ROLLBACK');
                    return apiResponse.error(
                        res,
                        `Return window of ${windowDays} day(s) has expired. This sale was ${daysDiff} days ago.`,
                        null,
                        400
                    );
                }
            }

            // ── 1d. Freeform returns (no sale_item_ids) require admin role ───
            const hasAnySaleItemId = items.some(i => i.sale_item_id);
            if (!hasAnySaleItemId && req.user?.role !== 'admin') {
                await run('ROLLBACK');
                return apiResponse.error(
                    res,
                    'Manual freeform returns require admin role. Select an invoice to load items automatically.',
                    null,
                    403
                );
            }
        }

        // ── 1b. If sale_id provided without sale_item_ids, enforce sale-level 
        //        return cap: total already returned + this return <= original sale amount
        if (sale_id && originalSale) {
            const hasAnySaleItemId = items.some(i => i.sale_item_id);
            if (!hasAnySaleItemId) {
                // Freeform return path: check aggregate already-returned value for this sale
                const prevRow = await get(
                    `SELECT COALESCE(SUM(total_amount), 0) AS already_returned
                     FROM sale_returns
                     WHERE sale_id = ?`,
                    [sale_id]
                );
                const alreadyReturned = prevRow?.already_returned || 0;
                // Compute what this return would total (using submitted item values)
                let thisReturnTotal = 0;
                for (const item of items) {
                    thisReturnTotal += item.quantity * item.price * (1 - (item.discount || 0) / 100);
                }
                thisReturnTotal = Math.round(thisReturnTotal * 100) / 100;

                if (alreadyReturned + thisReturnTotal > originalSale.final_amount + 0.01) {
                    await run('ROLLBACK');
                    return apiResponse.error(
                        res,
                        `Cannot process return: ₹${alreadyReturned.toFixed(2)} already returned against this invoice (original: ₹${originalSale.final_amount.toFixed(2)}). Maximum returnable: ₹${Math.max(0, originalSale.final_amount - alreadyReturned).toFixed(2)}`,
                        null,
                        400
                    );
                }
            }
        }

        // ── 2. Validate each item: product exists + quantity cap ─────────────
        for (const item of items) {
            // 2a. Product must exist
            const product = await get(
                'SELECT id, stock_quantity FROM products WHERE id = ?',
                [item.product_id]
            );
            if (!product) {
                await run('ROLLBACK');
                return apiResponse.error(
                    res,
                    `Product #${item.product_id} not found`,
                    null,
                    404
                );
            }

            // 2b. If sale_item_id provided, enforce return quantity cap
            if (item.sale_item_id && sale_id) {
                const saleItem = await get(
                    'SELECT id, quantity, returned_quantity FROM sale_items WHERE id = ? AND sale_id = ?',
                    [item.sale_item_id, sale_id]
                );
                if (!saleItem) {
                    await run('ROLLBACK');
                    return apiResponse.error(
                        res,
                        `Sale item #${item.sale_item_id} does not belong to sale #${sale_id}`,
                        null,
                        400
                    );
                }
                const alreadyReturned = saleItem.returned_quantity || 0;
                const maxReturnable = saleItem.quantity - alreadyReturned;
                if (item.quantity > maxReturnable) {
                    await run('ROLLBACK');
                    return apiResponse.error(
                        res,
                        `Cannot return ${item.quantity} units for item #${item.sale_item_id} — only ${maxReturnable} unit(s) returnable (${saleItem.quantity} sold, ${alreadyReturned} already returned)`,
                        null,
                        400
                    );
                }
            }
        }

        // ── 3. Compute total amount (backend is source of truth) ─────────────
        let totalAmount = 0;
        for (const item of items) {
            const lineTotal = item.quantity * item.price * (1 - (item.discount || 0) / 100);
            totalAmount += lineTotal;
        }
        totalAmount = Math.round(totalAmount * 100) / 100;

        // ── 4. Validate refund does not exceed return value ──────────────────
        const totalRefund = (refund_cash || 0) + (refund_upi || 0);
        if (totalRefund > totalAmount + 0.01) {
            await run('ROLLBACK');
            return apiResponse.error(
                res,
                `Refund total ₹${totalRefund.toFixed(2)} cannot exceed return value ₹${totalAmount.toFixed(2)}`,
                null,
                400
            );
        }

        // ── 5. Generate SR number ────────────────────────────────────────────
        const seqRow = await get('SELECT last_number FROM sr_sequence WHERE id = 1');
        const newNum = (seqRow?.last_number || 0) + 1;
        await run('UPDATE sr_sequence SET last_number = ? WHERE id = 1', [newNum]);
        const srNumber = `SR-${String(newNum).padStart(5, '0')}`;

        // ── 6. Insert sale_returns record ────────────────────────────────────
        const srRes = await run(
            `INSERT INTO sale_returns 
             (return_number, sale_id, total_amount, refund_cash, refund_upi, reason, status, user_id)
             VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`,
            [srNumber, sale_id || null, totalAmount, refund_cash || 0, refund_upi || 0, reason, processedBy]
        );
        const srId = srRes.lastID;

        // ── 7. Insert items, update returned_quantity, restore stock ─────────
        for (const item of items) {
            // Fetch gst_percentage for this product (for GST reversal tracking)
            const productForGst = await get(
                'SELECT gst_percentage FROM products WHERE id = ?',
                [item.product_id]
            );
            const itemGst = productForGst?.gst_percentage || 0;

            await run(
                `INSERT INTO sale_return_items 
                 (return_id, product_id, quantity, price, discount, sale_item_id, return_condition, gst_percentage)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [srId, item.product_id, item.quantity, item.price, item.discount || 0,
                 item.sale_item_id || null, item.return_condition || 'resellable', itemGst]
            );

            // Update returned_quantity on the original sale_item if linked
            if (item.sale_item_id && sale_id) {
                await run(
                    `UPDATE sale_items 
                     SET returned_quantity = returned_quantity + ? 
                     WHERE id = ? AND sale_id = ?`,
                    [item.quantity, item.sale_item_id, sale_id]
                );
            }

            // Restore stock only if condition is resellable
            const condition = item.return_condition || 'resellable';
            if (condition === 'resellable') {
                await run(
                    `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
                    [item.quantity, item.product_id]
                );
            }
            // Damaged and expired items: stock NOT restored (item written off)
        }

        // ── 8. Adjust customer credit if original sale was a credit sale ─────
        if (originalSale && originalSale.credit_amount > 0 && originalSale.customer_id) {
            // Return reduces what the customer owes (proportional to return value)
            const creditReduction = Math.min(originalSale.credit_amount, totalAmount);
            await run(
                `UPDATE customers 
                 SET credit_balance = MAX(0, credit_balance - ?) 
                 WHERE id = ?`,
                [creditReduction, originalSale.customer_id]
            );
        }

        await run('COMMIT');

        // ── 9. Log activity (outside transaction, failures are swallowed) ────
        logActivity(
            processedBy,
            'sale_return_processed',
            `Return ${srNumber} processed${sale_id ? ` for invoice ${originalSale?.invoice_number || '#' + sale_id}` : ' (freeform)'} — ₹${totalAmount.toFixed(2)} | Refund: cash ₹${(refund_cash || 0).toFixed(2)}, UPI ₹${(refund_upi || 0).toFixed(2)} | Reason: ${reason}`
        );

        return apiResponse.success(res, 'Sale return recorded', { return_number: srNumber, id: srId }, 201);

    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        return apiResponse.error(res, err.message || 'Failed to record sale return', err, 500);
    }
});

router.get('/sale-returns', (req, res) => {
    db.all(
        `SELECT sr.*,
                DATETIME(sr.created_at, 'localtime') AS created_at_local,
                (SELECT COUNT(*) FROM sale_return_items sri WHERE sri.return_id = sr.id) AS item_count,
                s.invoice_number AS linked_invoice_number,
                s.status AS linked_sale_status,
                u.name AS processed_by_name,
                (SELECT GROUP_CONCAT(DISTINCT return_condition) FROM sale_return_items sri2 WHERE sri2.return_id = sr.id) AS condition_summary
         FROM sale_returns sr
         LEFT JOIN sales s ON s.id = sr.sale_id
         LEFT JOIN users u ON u.id = sr.user_id
         ORDER BY sr.id DESC`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch sale returns', err, 500);
            return apiResponse.success(res, 'Sale returns fetched', rows);
        }
    );
});

router.get('/sale-returns/analytics', async (req, res) => {
    try {
        const [totals, topReturned, reasonBreakdown, conditionBreakdown] = await Promise.all([
            // Overall totals
            get(
                `SELECT COUNT(*) AS total_returns,
                        COALESCE(SUM(total_amount), 0) AS total_value,
                        COALESCE(SUM(refund_cash), 0) AS total_cash,
                        COALESCE(SUM(refund_upi), 0) AS total_upi
                 FROM sale_returns`
            ),
            // Most returned products (top 10)
            new Promise((resolve, reject) => {
                db.all(
                    `SELECT p.name AS product_name,
                            SUM(sri.quantity) AS total_returned_qty,
                            COUNT(DISTINCT sri.return_id) AS return_count,
                            COALESCE(SUM(sri.quantity * sri.price * (1 - sri.discount/100)), 0) AS total_value
                     FROM sale_return_items sri
                     LEFT JOIN products p ON p.id = sri.product_id
                     GROUP BY sri.product_id
                     ORDER BY total_returned_qty DESC
                     LIMIT 10`,
                    [],
                    (err, rows) => err ? reject(err) : resolve(rows)
                );
            }),
            // Returns by reason
            new Promise((resolve, reject) => {
                db.all(
                    `SELECT reason, COUNT(*) AS count,
                            COALESCE(SUM(total_amount), 0) AS total_value
                     FROM sale_returns
                     WHERE reason IS NOT NULL
                     GROUP BY reason
                     ORDER BY count DESC`,
                    [],
                    (err, rows) => err ? reject(err) : resolve(rows)
                );
            }),
            // Returns by condition (resellable vs damaged vs expired)
            new Promise((resolve, reject) => {
                db.all(
                    `SELECT return_condition,
                            COUNT(*) AS item_count,
                            SUM(quantity) AS total_qty
                     FROM sale_return_items
                     GROUP BY return_condition`,
                    [],
                    (err, rows) => err ? reject(err) : resolve(rows)
                );
            }),
        ]);

        return apiResponse.success(res, 'Analytics fetched', {
            totals,
            top_returned_products: topReturned,
            reason_breakdown: reasonBreakdown,
            condition_breakdown: conditionBreakdown,
        });
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch analytics', err, 500);
    }
});

/* ── Single Sale Return Detail ────────────────────────────────── */
router.get('/sale-return/:id', validate(getSaleReturnDetailOptions), async (req, res) => {
    const returnId = req.params.id;

    try {
        const returnHeader = await get(
            `SELECT sr.*,
                    DATETIME(sr.created_at, 'localtime') AS created_at_local,
                    s.invoice_number AS linked_invoice_number,
                    s.status AS linked_invoice_status,
                    u.name AS processed_by_name
             FROM sale_returns sr
             LEFT JOIN sales s ON s.id = sr.sale_id
             LEFT JOIN users u ON u.id = sr.user_id
             WHERE sr.id = ?`,
            [returnId]
        );

        if (!returnHeader) {
            return apiResponse.error(res, 'Sale return not found', null, 404);
        }

        const items = await new Promise((resolve, reject) => {
            db.all(
                `SELECT sri.id, sri.product_id, sri.quantity, sri.price, sri.discount,
                        sri.return_condition, sri.gst_percentage, sri.sale_item_id,
                        p.name AS product_name
                 FROM sale_return_items sri
                 LEFT JOIN products p ON p.id = sri.product_id
                 WHERE sri.return_id = ?`,
                [returnId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        return apiResponse.success(res, 'Sale return detail fetched', {
            ...returnHeader,
            items
        });
    } catch (err) {
        return apiResponse.error(res, err.message || 'Failed to fetch sale return detail', err, 500);
    }
});

module.exports = router;
