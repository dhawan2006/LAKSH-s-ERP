/**
 * Report Routes
 * GET /daily-report           — Today's summary (sales, profit, GST, products)
 * GET /weekly-report          — 7-day daily trend (for chart)
 * GET /weekly-report-summary  — Week aggregate totals
 * GET /monthly-report-summary — Month-to-date aggregate totals
 * GET /range-report           — Custom date range aggregate (?from=&to=)
 * GET /sales-trend            — Sales trend for reports chart (?range=today|week|month)
 * GET /sale-items/:id         — Line items for a specific sale
 * GET /customer-ledger/:id    — All sales for a specific customer
 * GET /pending-credit         — Total outstanding credit summary
 */

'use strict';

const express = require('express');
const router = express.Router();
const { get: dbGet, all: dbAll } = require('../utils/db-promise');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const {
    rangeReportOptions,
    salesTrendOptions,
    getSaleItemsOptions,
    getCustomerLedgerOptions
} = require('../validators/report.validator');

/* ─── Sale Line Items (any authenticated user) ────────────────── */
router.get('/sale-items/:id', validate(getSaleItemsOptions), async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT si.*, p.name AS product_name, p.gst_percentage
             FROM   sale_items si
             LEFT   JOIN products p ON p.id = si.product_id
             WHERE  si.sale_id = ?`,
            [req.params.id]
        );
        return apiResponse.success(res, 'Sale items fetched', rows);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch sale items', err, 500);
    }
});

/* ─── Customer Ledger (any authenticated user) ────────────────── */
router.get('/customer-ledger/:id', validate(getCustomerLedgerOptions), async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT s.*, c.name AS customer_name,
                    DATETIME(s.created_at, 'localtime') AS created_at_local
             FROM   sales s
             LEFT   JOIN customers c ON c.id = s.customer_id
             WHERE  s.customer_id = ?
             ORDER  BY s.id DESC`,
            [req.params.id]
        );
        return apiResponse.success(res, 'Customer ledger fetched', rows);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch customer ledger', err, 500);
    }
});

// Apply admin guard to all remaining report routes
router.use(requireAdmin);

/* ─── Daily Report ────────────────────────────────────────────── */
router.get('/daily-report', async (req, res) => {
    try {
        const data = await buildRangeReport('dynamic', 'dynamic', 'today');
        return apiResponse.success(res, 'Daily report fetched', data);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch daily report', err, 500);
    }
});

/* ─── Weekly 7-Day Trend (chart data) ────────────────────────── */
router.get('/weekly-report', async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT
                 DATE(created_at, 'localtime') AS date,
                 COALESCE(SUM(final_amount), 0) AS total,
                 COUNT(*)                        AS bills
             FROM   sales
             WHERE  DATE(created_at, 'localtime') >= DATE('now', '-6 days', 'localtime')
             GROUP  BY DATE(created_at, 'localtime')
             ORDER  BY date ASC`,
            []
        );

        // Fill any missing days so the chart always has 7 data points
        const result = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const found = rows.find(r => r.date === dateStr);
            result.push({ date: dateStr, total: found?.total || 0, bills: found?.bills || 0 });
        }
        return apiResponse.success(res, 'Weekly trend fetched', result);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch weekly trend', err, 500);
    }
});

/* ─── Weekly Summary ──────────────────────────────────────────── */
router.get('/weekly-report-summary', async (req, res) => {
    try {
        const data = await buildRangeReport('dynamic', 'dynamic', 'week');
        return apiResponse.success(res, 'Weekly summary fetched', data);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch weekly summary', err, 500);
    }
});

/* ─── Monthly Summary ─────────────────────────────────────────── */
router.get('/monthly-report-summary', async (req, res) => {
    try {
        const data = await buildRangeReport('dynamic', 'dynamic', 'month');
        return apiResponse.success(res, 'Monthly summary fetched', data);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch monthly summary', err, 500);
    }
});

/* ─── Custom Date Range Report ────────────────────────────────── */
router.get('/range-report', validate(rangeReportOptions), async (req, res) => {
    const { from, to } = req.query;

    try {
        const data = await buildRangeReport(from, to, 'custom');
        return apiResponse.success(res, 'Range report fetched', data);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch range report', err, 500);
    }
});

/* ─── Sales Trend (for Reports chart) ────────────────────────── */
router.get('/sales-trend', validate(salesTrendOptions), async (req, res) => {
    const { range } = req.query;

    // Use dynamic SQLite date expressions (no user input interpolated)
    const fromMap = {
        today: `DATE('now', 'localtime')`,
        week: `DATE('now', '-6 days', 'localtime')`,
        month: `DATE('now', 'start of month', 'localtime')`,
    };

    const fromExpr = fromMap[range] || fromMap.month;

    try {
        const rows = await dbAll(
            `SELECT
                 DATE(created_at, 'localtime') AS date,
                 COALESCE(SUM(final_amount), 0) AS total,
                 COUNT(*)                        AS bills
             FROM   sales
             WHERE  DATE(created_at, 'localtime') >= ${fromExpr}
             GROUP  BY DATE(created_at, 'localtime')
             ORDER  BY date ASC`,
            []
        );
        return apiResponse.success(res, 'Sales trend fetched', rows);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch sales trend', err, 500);
    }
});

/* ─── Pending Credit Summary ──────────────────────────────────── */
router.get('/pending-credit', async (req, res) => {
    try {
        const row = await dbGet(
            `SELECT
                 COALESCE(SUM(credit_balance), 0) AS totalPending,
                 COUNT(*)                          AS customersWithBalance
             FROM customers
             WHERE credit_balance > 0`,
            []
        );
        return apiResponse.success(res, 'Pending credit fetched', row);
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch pending credit', err, 500);
    }
});

/* ─── Helper: Build Aggregate Report for a Date Range ────────── */

/**
 * Builds an aggregate report. For dynamic periods (today/week/month), uses SQLite
 * date functions directly (safe — no user input). For custom ranges, uses
 * parameterized queries with ? placeholders (no SQL injection).
 *
 * @param {string} from - Start date (YYYY-MM-DD) or 'dynamic'
 * @param {string} to   - End date (YYYY-MM-DD) or 'dynamic'
 * @param {string} period - 'today' | 'week' | 'month' | 'custom'
 * @returns {Object} Aggregate report data
 */
async function buildRangeReport(from, to, period) {
    let whereClause;
    let params = [];

    if (period === 'custom') {
        // Parameterized — dates passed as ? placeholders (SQL injection safe)
        whereClause = `DATE(s.created_at, 'localtime') BETWEEN DATE(?) AND DATE(?)`;
        params = [from, to];
    } else if (period === 'today') {
        whereClause = `DATE(s.created_at, 'localtime') = DATE('now', 'localtime')`;
    } else if (period === 'week') {
        whereClause = `DATE(s.created_at, 'localtime') BETWEEN DATE('now', '-6 days', 'localtime') AND DATE('now', 'localtime')`;
    } else {
        // month
        whereClause = `DATE(s.created_at, 'localtime') BETWEEN DATE('now', 'start of month', 'localtime') AND DATE('now', 'localtime')`;
    }

    const [totals, profitRow, products, gstSummary] = await Promise.all([
        dbGet(
            `SELECT
                 COALESCE(SUM(final_amount), 0)  AS totalSales,
                 COALESCE(SUM(credit_amount), 0) AS totalCredit,
                 COALESCE(SUM(cash_paid), 0)     AS totalCash,
                 COALESCE(SUM(upi_paid), 0)      AS totalUPI,
                 COUNT(*)                         AS totalBills
             FROM sales s
             WHERE ${whereClause}`,
            params
        ),
        dbGet(
            `SELECT COALESCE(
                 SUM((si.price * (1 - si.discount / 100) - si.cost_price) * si.quantity), 0
             ) AS totalProfit
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             WHERE ${whereClause}`,
            params
        ),
        dbAll(
            `SELECT p.name,
                    SUM(si.quantity)                                   AS total_quantity,
                    SUM(si.quantity * si.price * (1 - si.discount/100)) AS total_revenue
             FROM sale_items si
             JOIN products p ON p.id = si.product_id
             JOIN sales s    ON s.id = si.sale_id
             WHERE ${whereClause}
             GROUP BY si.product_id
             ORDER BY total_quantity DESC`,
            params
        ),
        dbAll(
            `SELECT
                 p.gst_percentage                                          AS gst_rate,
                 SUM(si.quantity * si.price * (1 - si.discount/100))       AS taxable,
                 SUM(si.quantity * si.price * (1 - si.discount/100)
                     * p.gst_percentage / 100)                             AS gst_amount
             FROM sale_items si
             JOIN products p ON p.id = si.product_id
             JOIN sales s    ON s.id = si.sale_id
             WHERE ${whereClause}
             GROUP BY p.gst_percentage
             ORDER BY p.gst_percentage`,
            params
        ),
    ]);

    return {
        totalSales: totals?.totalSales || 0,
        totalCredit: totals?.totalCredit || 0,
        totalCash: totals?.totalCash || 0,
        totalUPI: totals?.totalUPI || 0,
        totalBills: totals?.totalBills || 0,
        totalProfit: profitRow?.totalProfit || 0,
        products: products || [],
        gstSummary: gstSummary || [],
    };
}

module.exports = router;
