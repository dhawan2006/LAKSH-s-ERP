/**
 * Register / Cash Drawer Routes
 * POST /open-register      — Open a new cash register session
 * GET  /register-status    — Current open register status
 * POST /close-register     — Close the register with closing cash count
 * GET  /register-history   — Past register sessions
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const { openRegisterOptions, closeRegisterOptions } = require('../validators/register.validator');

/* ─── Open Register ───────────────────────────────────────────── */
router.post('/open-register', validate(openRegisterOptions), (req, res) => {
    const { opening_cash, operator_name } = req.body;

    // Check if a register is already open
    db.get(`SELECT id FROM registers WHERE status = 'OPEN'`, [], (err, existing) => {
        if (err) return apiResponse.error(res, 'Database error', err, 500);
        if (existing) return apiResponse.error(res, 'A register session is already open. Close it first.', null, 400);

        db.run(
            `INSERT INTO registers (opening_cash, operator_name, status) VALUES (?, ?, 'OPEN')`,
            [opening_cash, operator_name || 'Store Admin'],
            function (err2) {
                if (err2) return apiResponse.error(res, 'Failed to open register', err2, 500);
                return apiResponse.success(res, 'Register opened', { id: this.lastID }, 201);
            }
        );
    });
});

/* ─── Register Status ─────────────────────────────────────────── */
router.get('/register-status', (req, res) => {
    db.get(
        `SELECT r.*,
                DATETIME(r.opened_at, 'localtime') AS opened_at_local,
                (SELECT COALESCE(SUM(cash_paid), 0) FROM sales
                 WHERE DATE(created_at, 'localtime') >= DATE(r.opened_at, 'localtime')
                 AND status = 'COMPLETED') AS cash_sales,
                (SELECT COALESCE(SUM(upi_paid), 0) FROM sales
                 WHERE DATE(created_at, 'localtime') >= DATE(r.opened_at, 'localtime')
                 AND status = 'COMPLETED') AS upi_sales,
                (SELECT COUNT(*) FROM sales
                 WHERE DATE(created_at, 'localtime') >= DATE(r.opened_at, 'localtime')
                 AND status = 'COMPLETED') AS bill_count
         FROM registers r WHERE r.status = 'OPEN' LIMIT 1`,
        [],
        (err, row) => {
            if (err) return apiResponse.error(res, 'Database error', err, 500);
            return apiResponse.success(res, 'Register status fetched', row || null);
        }
    );
});

/* ─── Close Register ──────────────────────────────────────────── */
router.post('/close-register', validate(closeRegisterOptions), (req, res) => {
    const { closing_cash, notes } = req.body;

    db.get(`SELECT * FROM registers WHERE status = 'OPEN'`, [], (err, register) => {
        if (err) return apiResponse.error(res, 'Database error', err, 500);
        if (!register) return apiResponse.error(res, 'No open register found', null, 400);

        db.get(
            `SELECT COALESCE(SUM(cash_paid), 0) AS cash_in, COALESCE(SUM(upi_paid), 0) AS upi_in
             FROM sales WHERE DATE(created_at, 'localtime') >= DATE(?, 'localtime') AND status = 'COMPLETED'`,
            [register.opened_at],
            (err2, totals) => {
                const expectedCash = register.opening_cash + (totals?.cash_in || 0);
                const difference = closing_cash - expectedCash;

                db.run(
                    `UPDATE registers SET
                        status = 'CLOSED', closing_cash = ?, expected_cash = ?, 
                        difference = ?, notes = ?, closed_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [closing_cash, expectedCash, difference, notes || null, register.id],
                    function (err3) {
                        if (err3) return apiResponse.error(res, 'Failed to close register', err3, 500);
                        return apiResponse.success(res, 'Register closed', {
                            opening_cash: register.opening_cash,
                            cash_sales: totals?.cash_in || 0,
                            expected_cash: expectedCash,
                            closing_cash: closing_cash,
                            difference,
                        });
                    }
                );
            }
        );
    });
});

/* ─── Register History ────────────────────────────────────────── */
router.get('/register-history', (req, res) => {
    db.all(
        `SELECT *,
                DATETIME(opened_at, 'localtime') AS opened_at_local,
                DATETIME(closed_at, 'localtime') AS closed_at_local
         FROM registers ORDER BY id DESC LIMIT 50`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch register history', err, 500);
            return apiResponse.success(res, 'Register history fetched', rows);
        }
    );
});

module.exports = router;
