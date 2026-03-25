/**
 * Held Bills Routes
 * GET    /held-bills        — List held bills for current user
 * POST   /held-bills        — Save/overwrite a held bill slot
 * DELETE /held-bills/:slot  — Delete a held bill slot
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const apiResponse = require('../utils/apiResponse');

/* ─── GET /held-bills — list all for current user ────────────── */
router.get('/held-bills', (req, res) => {
    const userId = req.user?.id || null;

    db.all(
        'SELECT * FROM held_bills WHERE user_id = ? ORDER BY slot ASC',
        [userId],
        (err, rows) => {
            if (err) {
                if (err.message.includes('no such table')) {
                    return apiResponse.success(res, 'No held bills', []);
                }
                return apiResponse.error(res, 'Failed to fetch held bills', err, 500);
            }
            // Parse cart_json for each row
            const parsed = (rows || []).map(r => ({
                ...r,
                cart_json: r.cart_json // keep raw — frontend parses
            }));
            return apiResponse.success(res, 'Held bills fetched', parsed);
        }
    );
});

/* ─── POST /held-bills — save/overwrite a slot ────────────────── */
router.post('/held-bills', (req, res) => {
    const userId = req.user?.id || null;
    const { slot, cart, customerId, customerName, billDiscount, discountType, grandTotal, itemCount } = req.body;

    // Validate slot
    if (!slot || ![1, 2, 3].includes(Number(slot))) {
        return apiResponse.error(res, 'Slot must be 1, 2, or 3', null, 400);
    }
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
        return apiResponse.error(res, 'Cart must be a non-empty array', null, 400);
    }

    // Delete existing slot then insert
    db.run(
        'DELETE FROM held_bills WHERE user_id = ? AND slot = ?',
        [userId, Number(slot)],
        (delErr) => {
            if (delErr && !delErr.message.includes('no such table')) {
                return apiResponse.error(res, 'Failed to clear slot', delErr, 500);
            }

            db.run(
                `INSERT INTO held_bills
                    (user_id, slot, cart_json, customer_id, customer_name, bill_discount, discount_type, grand_total, item_count, held_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [
                    userId,
                    Number(slot),
                    JSON.stringify(cart),
                    customerId || null,
                    customerName || null,
                    String(billDiscount || '0'),
                    discountType || 'flat',
                    String(grandTotal || '0'),
                    Number(itemCount) || 0,
                ],
                function (insertErr) {
                    if (insertErr) {
                        return apiResponse.error(res, 'Failed to hold bill', insertErr, 500);
                    }
                    return apiResponse.success(res, 'Bill held successfully', { id: this.lastID, slot: Number(slot) }, 201);
                }
            );
        }
    );
});

/* ─── DELETE /held-bills/:slot — remove a slot ────────────────── */
router.delete('/held-bills/:slot', (req, res) => {
    const userId = req.user?.id || null;
    const slot = Number(req.params.slot);

    if (![1, 2, 3].includes(slot)) {
        return apiResponse.error(res, 'Slot must be 1, 2, or 3', null, 400);
    }

    db.run(
        'DELETE FROM held_bills WHERE user_id = ? AND slot = ?',
        [userId, slot],
        function (err) {
            if (err) return apiResponse.error(res, 'Failed to delete held bill', err, 500);
            return apiResponse.success(res, 'Held bill discarded');
        }
    );
});

module.exports = router;
