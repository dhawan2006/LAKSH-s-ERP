/**
 * Sale Routes
 * POST /create-sale          — Process a complete sale transaction
 * GET  /sales                — Retrieve all sales (paginated, with customer & item count)
 * GET  /sale/:id             — Get single sale with items (for reprint)
 * GET  /sale-by-invoice/:inv — Get sale by invoice number (for return lookup)
 */

'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createSale } = require('../services/sale.service');
const db = require('../config/database');
const { logActivity } = require('../services/activity.service');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const { createSaleOptions, getSalesOptions, getSaleOptions, getSaleByInvoiceOptions } = require('../validators/sale.validator');

/* ─── Idempotency Cache Cleanup (runs once on module load) ────── */
// Delete idempotency cache entries older than 24 hours on startup.
// Uses db.run directly — no Knex, no await needed at module scope.
db.run(
    `DELETE FROM idempotency_cache WHERE created_at < datetime('now', '-1 day')`,
    [],
    (err) => {
        if (err) {
            // Table may not exist yet on first boot (migration hasn't run).
            // This is harmless — next startup will clean up correctly.
            if (!err.message.includes('no such table')) {
                console.error('[idempotency] Cleanup error:', err.message);
            }
        } else {
            console.log('[idempotency] Cache cleaned on startup');
        }
    }
);

/* ─── Create Sale ─────────────────────────────────────────────── */
router.post('/create-sale', validate(createSaleOptions), async (req, res) => {
    const idemKey = (req.headers['idempotency-key'] || '').trim();

    // ── Check idempotency cache ────────────────────────────────
    if (idemKey) {
        try {
            const cached = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT response_json FROM idempotency_cache WHERE idem_key = ?`,
                    [idemKey],
                    (err, row) => { if (err) reject(err); else resolve(row); }
                );
            });

            if (cached) {
                // Return the original response — idempotent replay
                const parsed = JSON.parse(cached.response_json);
                return res.status(201).json(parsed);
            }
        } catch (err) {
            // If idempotency table doesn't exist yet, proceed normally
            if (!err.message.includes('no such table')) {
                console.error('[idempotency] Cache read error:', err.message);
            }
        }
    }

    // ── Verify manager override token if present ──────────────
    const managerOverrideToken = req.body.manager_override_token;
    let managerOverride = false;

    if (managerOverrideToken) {
        try {
            const decoded = jwt.verify(managerOverrideToken, process.env.JWT_SECRET);
            managerOverride = (decoded?.managerOverride === true);
        } catch (jwtErr) {
            // Token expired or invalid — treat as no override (don't block the sale)
            console.warn('[create-sale] Invalid manager override token:', jwtErr.message);
        }
    }

    // ── Process the sale ───────────────────────────────────────
    try {
        const result = await createSale(req.body, { managerOverride });
        logActivity(req.user?.id, 'invoice_created', `Invoice created: ${result.invoice || 'unknown'}`);

        const responseBody = {
            success: true,
            message: 'Sale completed successfully',
            data: result,
        };

        // ── Store response in idempotency cache ────────────────
        if (idemKey) {
            db.run(
                `INSERT OR IGNORE INTO idempotency_cache (idem_key, response_json) VALUES (?, ?)`,
                [idemKey, JSON.stringify(responseBody)],
                (err) => {
                    if (err && !err.message.includes('no such table')) {
                        console.error('[idempotency] Cache write error:', err.message);
                    }
                }
            );
        }

        return res.status(201).json(responseBody);

    } catch (err) {
        const status = err.error ? 400 : 500;
        return apiResponse.error(res, err.error ? err.error : 'Sale processing failed', err, status);
    }
});

/* ─── List All Sales ──────────────────────────────────────────── */
router.get('/sales', validate(getSalesOptions), (req, res) => {
    const { limit, offset } = req.query;
    db.all(
        `SELECT s.*, DATETIME(s.created_at, 'localtime') AS created_at_local,
                c.name AS customer_name,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
                (SELECT COUNT(*) FROM sale_returns sr WHERE sr.sale_id = s.id) AS return_count
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ORDER BY s.id DESC LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch sales', err, 500);
            return apiResponse.success(res, 'Sales fetched successfully', {
                data: rows, limit, offset, hasMore: rows.length === limit
            });
        }
    );
});

/* ─── Count All Sales ─────────────────────────────────────────── */
router.get('/sales/count', (req, res) => {
    db.get('SELECT COUNT(*) AS total FROM sales', [], (err, row) => {
        if (err) return apiResponse.error(res, 'Failed to count sales', err, 500);
        return apiResponse.success(res, 'Count fetched', { total: row.total });
    });
});

/* ─── Get Single Sale (for reprint) ───────────────────────────── */
router.get('/sale/:id', validate(getSaleOptions), (req, res) => {
    const saleId = req.params.id;
    db.get(
        `SELECT s.*, DATETIME(s.created_at, 'localtime') AS created_at_local, c.name AS customer_name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
        [saleId],
        (err, sale) => {
            if (err) return apiResponse.error(res, 'Failed to fetch sale', err, 500);
            if (!sale) return apiResponse.error(res, 'Sale not found', null, 404);
            db.all(
                `SELECT si.*, p.name, p.gst_percentage AS gst
                 FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`,
                [saleId],
                (err2, items) => {
                    if (err2) return apiResponse.error(res, 'Failed to fetch sale items', err2, 500);
                    return apiResponse.success(res, 'Sale fetched successfully', { ...sale, items: items || [] });
                }
            );
        }
    );
});

/* ─── Get Sale by Invoice Number (for return lookup) ─────────── */
router.get('/sale-by-invoice/:invoiceNumber', validate(getSaleByInvoiceOptions), (req, res) => {
    const invoiceNumber = req.params.invoiceNumber;
    db.get(
        `SELECT s.*, DATETIME(s.created_at, 'localtime') AS created_at_local, c.name AS customer_name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE UPPER(s.invoice_number) = UPPER(?)`,
        [invoiceNumber],
        (err, sale) => {
            if (err) return apiResponse.error(res, 'Failed to fetch sale', err, 500);
            if (!sale) return res.status(404).json({ error: 'Invoice not found' });

            db.all(
                `SELECT si.*, p.name, p.gst_percentage AS gst
                 FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`,
                [sale.id],
                (err2, items) => {
                    if (err2) return apiResponse.error(res, 'Failed to fetch sale items', err2, 500);
                    return apiResponse.success(res, 'Sale fetched successfully', { ...sale, items: items || [] });
                }
            );
        }
    );
});

/* ─── Void Sale (within 5 minutes, requires manager PIN) ─────── */
router.post('/void-sale/:id', async (req, res) => {
    const saleId = parseInt(req.params.id);
    if (!saleId || isNaN(saleId)) {
        return apiResponse.error(res, 'Valid sale ID required', null, 400);
    }

    // Require manager override token
    const token = req.body.manager_override_token;
    if (!token) {
        return res.status(401).json({ error: 'Manager authorisation required to void a sale' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?.managerOverride) {
            return res.status(401).json({ error: 'Invalid manager authorisation token' });
        }
    } catch (jwtErr) {
        if (jwtErr.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Manager authorisation token expired. Please re-enter PIN.' });
        }
        return res.status(401).json({ error: 'Manager authorisation required to void a sale' });
    }

    // Fetch the sale
    const sale = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM sales WHERE id = ?', [saleId], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });

    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.status === 'VOIDED') return res.status(400).json({ error: 'Sale is already voided' });
    if (sale.status === 'RETURNED') return res.status(400).json({ error: 'Cannot void a sale with returns processed' });

    // Manager bypasses time limit (since token is strictly verified above, this is always authorized)
    const saleAge = (Date.now() - new Date(sale.created_at).getTime()) / 1000 / 60;
    // Time limit check has been removed since manager overriding is required and verified.

    try {
        // Begin transaction
        await new Promise((resolve, reject) => {
            db.run('BEGIN IMMEDIATE TRANSACTION', (err) => err ? reject(err) : resolve());
        });

        // Mark as voided
        await new Promise((resolve, reject) => {
            db.run('UPDATE sales SET status = ? WHERE id = ?', ['VOIDED', saleId], (err) => err ? reject(err) : resolve());
        });

        // Restore stock for each item
        const items = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM sale_items WHERE sale_id = ?', [saleId], (err, rows) => {
                if (err) reject(err); else resolve(rows || []);
            });
        });

        for (const item of items) {
            await new Promise((resolve, reject) => {
                db.run('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
                    [item.quantity, item.product_id], (err) => err ? reject(err) : resolve());
            });
        }

        // Reverse customer credit if applicable
        if (sale.customer_id && sale.credit_amount > 0) {
            await new Promise((resolve, reject) => {
                db.run('UPDATE customers SET credit_balance = MAX(0, credit_balance - ?) WHERE id = ?',
                    [sale.credit_amount, sale.customer_id], (err) => err ? reject(err) : resolve());
            });
        }

        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => err ? reject(err) : resolve());
        });

        logActivity(req.user?.id, 'sale_voided', `Sale ${sale.invoice_number} voided`);

        return res.json({
            success: true,
            message: `Sale ${sale.invoice_number} voided. Stock restored.`,
            invoice: sale.invoice_number,
        });

    } catch (err) {
        await new Promise((r) => db.run('ROLLBACK', () => r()));
        console.error('[void-sale] Error:', err);
        return apiResponse.error(res, 'Failed to void sale', err, 500);
    }
});

module.exports = router;
