'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { get, run } = require('../utils/db-promise');
const db = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const { profitLossOptions, productBulkDiscountOptions } = require('../validators/misc.validator');

/* ─── Backup ──────────────────────────────────────────────────── */
router.get('/backup', (req, res) => {
    const source = path.join(__dirname, '../../billing.db');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_${timestamp}.db`;
    // We'll write this to the src dir or project root
    const dest = path.join(__dirname, `../../${backupName}`);

    fs.copyFile(source, dest, (err) => {
        if (err) return apiResponse.error(res, 'Backup failed', err, 500);
        return apiResponse.success(res, 'Backup created successfully', { file: backupName });
    });
});

/* ─── Profit & Loss ───────────────────────────────────────────── */
router.get('/profit-loss', validate(profitLossOptions), asyncHandler(async (req, res) => {
    const { from, to, period } = req.query;
    let whereClauseSales, whereClauseOther;
    let params = [];

    if (period === 'today') {
        whereClauseSales = `DATE(s.created_at,'localtime') = DATE('now','localtime')`;
        whereClauseOther = `DATE(created_at,'localtime') = DATE('now','localtime')`;
    } else if (period === 'week') {
        whereClauseSales = `DATE(s.created_at,'localtime') BETWEEN DATE('now','-6 days','localtime') AND DATE('now','localtime')`;
        whereClauseOther = `DATE(created_at,'localtime') BETWEEN DATE('now','-6 days','localtime') AND DATE('now','localtime')`;
    } else if (period === 'month') {
        whereClauseSales = `DATE(s.created_at,'localtime') BETWEEN DATE('now','start of month','localtime') AND DATE('now','localtime')`;
        whereClauseOther = `DATE(created_at,'localtime') BETWEEN DATE('now','start of month','localtime') AND DATE('now','localtime')`;
    } else if (from && to) {
        whereClauseSales = `DATE(s.created_at,'localtime') BETWEEN DATE(?) AND DATE(?)`;
        whereClauseOther = `DATE(created_at,'localtime') BETWEEN DATE(?) AND DATE(?)`;
        params = [from, to];
    } else {
        whereClauseSales = `DATE(s.created_at,'localtime') BETWEEN DATE('now','start of month','localtime') AND DATE('now','localtime')`;
        whereClauseOther = `DATE(created_at,'localtime') BETWEEN DATE('now','start of month','localtime') AND DATE('now','localtime')`;
    }

    const [rev, cogs, pur, ret] = await Promise.all([
        get(`SELECT COALESCE(SUM(final_amount),0) AS gross_revenue, COALESCE(SUM(gst_amount),0) AS gst_collected, COUNT(*) AS total_bills FROM sales s WHERE ${whereClauseSales}`, params),
        get(`SELECT COALESCE(SUM(si.cost_price*si.quantity),0) AS cogs, COALESCE(SUM((si.price*(1-si.discount/100)-si.cost_price)*si.quantity),0) AS gross_profit FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${whereClauseSales}`, params),
        get(`SELECT COALESCE(SUM(total_amount),0) AS total_purchases FROM purchases WHERE ${whereClauseOther}`, params),
        get(`SELECT COALESCE(SUM(total_amount),0) AS total_returns FROM sale_returns WHERE ${whereClauseOther}`, params)
    ]);

    const gr = rev?.gross_revenue || 0;
    const gp = cogs?.gross_profit || 0;
    const tr = ret?.total_returns || 0;
    const np = gp - tr;

    return apiResponse.success(res, 'Profit and Loss data fetched', {
        gross_revenue: +gr.toFixed(2),
        total_cogs: +(cogs?.cogs || 0).toFixed(2),
        gross_profit: +gp.toFixed(2),
        total_sale_returns: +tr.toFixed(2),
        net_profit: +np.toFixed(2),
        profit_margin_pct: gr > 0 ? +((np / gr) * 100).toFixed(2) : 0,
        total_gst_collected: +(rev?.gst_collected || 0).toFixed(2),
        total_bills: rev?.total_bills || 0,
        total_purchases: +(pur?.total_purchases || 0).toFixed(2),
    });
}));

/* ─── Bulk Discount ───────────────────────────────────────────── */
router.put('/product-bulk-discount/:id', validate(productBulkDiscountOptions), (req, res) => {
    const { bulk_qty, bulk_discount } = req.body;
    db.run(
        `UPDATE products SET bulk_qty=?, bulk_discount=? WHERE id=?`,
        [bulk_qty, bulk_discount, req.params.id],
        function (err) {
            if (err) return apiResponse.error(res, 'Failed to update bulk discount', err, 500);
            if (this.changes === 0) return apiResponse.error(res, 'Product not found', null, 404);
            return apiResponse.success(res, 'Bulk discount updated');
        }
    );
});

/* ─── Redeem Loyalty Points ────────────────────────────────────── */
router.post('/customers/:id/redeem-points', asyncHandler(async (req, res) => {
    const customerId = parseInt(req.params.id);
    const { points_to_redeem } = req.body;

    if (!points_to_redeem || !Number.isInteger(points_to_redeem) || points_to_redeem <= 0) {
        return apiResponse.error(res, 'points_to_redeem must be a positive integer', null, 400);
    }

    const settings = await get(
        'SELECT loyalty_enabled, loyalty_redeem_rate, loyalty_min_redeem FROM invoice_settings WHERE id = 1'
    );
    if (!settings || settings.loyalty_enabled !== 1) {
        return apiResponse.error(res, 'Loyalty program is disabled', null, 400);
    }

    const customer = await get('SELECT id, loyalty_points FROM customers WHERE id = ?', [customerId]);
    if (!customer) {
        return apiResponse.error(res, 'Customer not found', null, 404);
    }

    const minRedeem = settings.loyalty_min_redeem || 10;
    if (customer.loyalty_points < minRedeem) {
        return apiResponse.error(res, `Minimum ${minRedeem} points required to redeem`, null, 400);
    }
    if (points_to_redeem > customer.loyalty_points) {
        return apiResponse.error(res, 'Insufficient points', null, 400);
    }

    const discountAmount = points_to_redeem * (settings.loyalty_redeem_rate || 1);

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
        await run(
            'UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id = ?',
            [points_to_redeem, customerId]
        );
        await run(
            `INSERT INTO loyalty_transactions (customer_id, type, points, note)
             VALUES (?, 'redeem', ?, 'Redeemed for bill discount')`,
            [customerId, -points_to_redeem]
        );
        await run('COMMIT');
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }

    const updated = await get('SELECT loyalty_points FROM customers WHERE id = ?', [customerId]);

    return apiResponse.success(res, 'Points redeemed successfully', {
        points_redeemed: points_to_redeem,
        discount_amount: Math.round(discountAmount * 100) / 100,
        remaining_points: updated?.loyalty_points || 0,
    });
}));

module.exports = router;
