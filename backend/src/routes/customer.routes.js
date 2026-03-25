/**
 * Customer Routes
 * POST /add-customer       — Create a new customer
 * GET  /customers          — List all customers
 * PUT  /update-customer/:id — Update customer details
 * POST /add-payment        — Record a credit payment
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { logActivity } = require('../services/activity.service');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const { addCustomerOptions, getCustomersOptions, updateCustomerOptions, addPaymentOptions } = require('../validators/customer.validator');

/* ─── Create Customer ─────────────────────────────────────────── */
router.post('/add-customer', validate(addCustomerOptions), (req, res) => {
    const { name, phone, address } = req.body;

    db.run(
        `INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)`,
        [name, phone, address],
        function (err) {
            if (err) return apiResponse.error(res, 'Failed to add customer', err, 500);
            logActivity(req.user?.id, 'customer_added', `Added customer: ${name}`);
            return apiResponse.success(res, 'Customer added successfully', { id: this.lastID }, 201);
        }
    );
});

/* ─── List All Customers ──────────────────────────────────────── */
router.get('/customers', validate(getCustomersOptions), (req, res) => {
    const { limit, offset } = req.query;

    db.all(
        `SELECT * FROM customers ORDER BY id DESC LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch customers', err, 500);
            return apiResponse.success(res, 'Customers fetched successfully', { data: rows, limit, offset, hasMore: rows.length === limit });
        }
    );
});

/* ─── Update Customer ─────────────────────────────────────────── */
router.put('/update-customer/:id', validate(updateCustomerOptions), (req, res) => {
    const { name, phone, address } = req.body;
    const { id } = req.params;

    db.run(
        `UPDATE customers SET name = ?, phone = ?, address = ? WHERE id = ?`,
        [name, phone, address, id],
        function (err) {
            if (err) return apiResponse.error(res, 'Failed to update customer', err, 500);
            if (this.changes === 0) return apiResponse.error(res, 'Customer not found', null, 404);
            return apiResponse.success(res, 'Customer updated successfully');
        }
    );
});

/* ─── Record Credit Payment ───────────────────────────────────── */
router.post('/add-payment', validate(addPaymentOptions), (req, res) => {
    const { customer_id, amount } = req.body;

    db.get(
        `SELECT id, name, credit_balance FROM customers WHERE id = ?`,
        [customer_id],
        (err, customer) => {
            if (err) return apiResponse.error(res, 'Database error', err, 500);
            if (!customer) return apiResponse.error(res, 'Customer not found', null, 404);

            if (amount > customer.credit_balance) {
                return apiResponse.error(res, `Payment ₹${amount} exceeds outstanding balance ₹${customer.credit_balance.toFixed(2)}`, null, 400);
            }

            db.run(
                `UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`,
                [amount, customer_id],
                function (err2) {
                    if (err2) return apiResponse.error(res, 'Payment processing failed', err2, 500);
                    return apiResponse.success(res, `Payment of ₹${amount} recorded for ${customer.name}`, {
                        remaining: parseFloat((customer.credit_balance - amount).toFixed(2))
                    });
                }
            );
        }
    );
});

/* ─── Receive Udhaar Payment ──────────────────────────────────── */
router.post('/customers/:id/receive-payment', async (req, res) => {
    const customerId = parseInt(req.params.id);
    if (!customerId || isNaN(customerId)) {
        return apiResponse.error(res, 'Valid customer ID required', null, 400);
    }

    const { amount, payment_mode = 'cash', note } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
        return apiResponse.error(res, 'Amount must be a positive number', null, 400);
    }
    if (!['cash', 'upi'].includes(payment_mode)) {
        return apiResponse.error(res, 'Payment mode must be cash or upi', null, 400);
    }

    try {
        // Get customer
        const customer = await new Promise((resolve, reject) => {
            db.get('SELECT id, name, credit_balance FROM customers WHERE id = ?', [customerId],
                (err, row) => err ? reject(err) : resolve(row));
        });

        if (!customer) {
            return apiResponse.error(res, 'Customer not found', null, 404);
        }

        const previousBalance = customer.credit_balance || 0;
        const newBalance = Math.max(0, previousBalance - amount);

        // Transaction: update customer + insert payment record
        await new Promise((resolve, reject) => {
            db.run('BEGIN IMMEDIATE TRANSACTION', (err) => err ? reject(err) : resolve());
        });

        await new Promise((resolve, reject) => {
            db.run('UPDATE customers SET credit_balance = ? WHERE id = ?',
                [newBalance, customerId], (err) => err ? reject(err) : resolve());
        });

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO credit_payments (customer_id, amount, payment_mode, note, recorded_by)
                 VALUES (?, ?, ?, ?, ?)`,
                [customerId, amount, payment_mode, note || null, req.user?.id || null],
                (err) => err ? reject(err) : resolve()
            );
        });

        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => err ? reject(err) : resolve());
        });

        logActivity(req.user?.id, 'credit_payment_received',
            `₹${amount} ${payment_mode} payment received from ${customer.name}. Balance: ₹${previousBalance} → ₹${newBalance}`);

        return apiResponse.success(res, 'Payment recorded successfully', {
            previous_balance: previousBalance,
            amount_paid: amount,
            new_balance: newBalance,
        });

    } catch (err) {
        await new Promise((r) => db.run('ROLLBACK', () => r()));
        console.error('[receive-payment] Error:', err);
        return apiResponse.error(res, 'Failed to record payment', err, 500);
    }
});

/* ─── Redeem Loyalty Points ───────────────────────────────────── */
router.post('/customers/:id/redeem-points', async (req, res) => {
    const customerId = parseInt(req.params.id);
    if (!customerId || isNaN(customerId)) {
        return apiResponse.error(res, 'Valid customer ID required', null, 400);
    }

    const { points } = req.body;

    if (!points || !Number.isInteger(points) || points <= 0) {
        return apiResponse.error(res, 'Points must be a positive integer', null, 400);
    }

    try {
        // Get customer
        const customer = await new Promise((resolve, reject) => {
            db.get('SELECT id, name, loyalty_points FROM customers WHERE id = ?', [customerId],
                (err, row) => err ? reject(err) : resolve(row));
        });

        if (!customer) {
            return apiResponse.error(res, 'Customer not found', null, 404);
        }

        if ((customer.loyalty_points || 0) < points) {
            return apiResponse.error(res, 'Insufficient loyalty points', null, 400);
        }

        // Fetch invoice_settings for redeem rate and minimum
        const settings = await new Promise((resolve, reject) => {
            db.get('SELECT loyalty_redeem_rate, loyalty_min_redeem FROM invoice_settings LIMIT 1',
                (err, row) => err ? reject(err) : resolve(row));
        });

        const redeemRate = Number(settings?.loyalty_redeem_rate) || 1;
        const minRedeem = Number(settings?.loyalty_min_redeem) || 0;

        if (minRedeem > 0 && points < minRedeem) {
            return apiResponse.error(res, `Minimum ${minRedeem} points required to redeem`, null, 400);
        }

        const discountAmount = Math.round(points * redeemRate * 100) / 100;

        // Transaction: update customer + insert loyalty_transactions record
        await new Promise((resolve, reject) => {
            db.run('BEGIN IMMEDIATE TRANSACTION', (err) => err ? reject(err) : resolve());
        });

        await new Promise((resolve, reject) => {
            db.run('UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id = ?',
                [points, customerId], (err) => err ? reject(err) : resolve());
        });

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO loyalty_transactions (customer_id, type, points, note) VALUES (?, 'redeem', ?, ?)`,
                [customerId, points, `Redeemed for ₹${discountAmount.toFixed(2)} discount`],
                (err) => err ? reject(err) : resolve()
            );
        });

        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => err ? reject(err) : resolve());
        });

        logActivity(req.user?.id, 'loyalty_redeemed',
            `${customer.name} redeemed ${points} pts for ₹${discountAmount.toFixed(2)} discount`);

        return apiResponse.success(res, 'Points redeemed successfully', {
            points_redeemed: points,
            discount_amount: discountAmount,
        });

    } catch (err) {
        await new Promise((r) => db.run('ROLLBACK', () => r()));
        console.error('[redeem-points] Error:', err);
        return apiResponse.error(res, 'Failed to redeem points', err, 500);
    }
});

module.exports = router;
